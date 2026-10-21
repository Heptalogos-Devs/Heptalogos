"""Hept channel plugin; AstrBot retains connection and native send ownership."""

from __future__ import annotations

import asyncio
import hmac
import json
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path
from sys import maxsize
from typing import Any
from uuid import uuid4

from aiohttp import ClientSession, ClientTimeout, web
from aiocqhttp import Event
from astrbot.api import AstrBotConfig
from astrbot.api.event import AstrMessageEvent, MessageChain, filter
from astrbot.api.message_components import (
    At, File, Image, Json, Node, Nodes, Plain, Record, Reply, Video,
)
from astrbot.api.star import Context, Star, register
from astrbot.core.platform.sources.aiocqhttp.aiocqhttp_message_event import (
    AiocqhttpMessageEvent,
)
from pydantic import ValidationError

from .contracts import Config, Scope, SendExpression


def timepoint(timestamp: float | None = None) -> dict:
    value = datetime.fromtimestamp(timestamp, timezone.utc) if timestamp is not None else datetime.now(timezone.utc)
    return {"domainId": "real", "at": value.isoformat(timespec="microseconds").replace("+00:00", "Z")}


@register("heptalogos", "Heptalogos", "Hept 主体渠道与实际发送回执", "0.1.0")
class HeptChannel(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context, config)
        self.settings = Config.model_validate(dict(config))
        self.runner: web.AppRunner | None = None
        self.http: ClientSession | None = None

    async def initialize(self):
        if not getattr(AiocqhttpMessageEvent, "supports_delivery_receipts", False):
            raise RuntimeError("Install the source-built AstrBot physical-delivery-receipts wheel")
        self.hept_token = os.environ[self.settings.heptTokenEnv]
        self.control_token = os.environ[self.settings.controlTokenEnv]
        if not self.hept_token or not self.control_token:
            raise ValueError("Hept service and channel control credentials must be configured")
        self.http = ClientSession(timeout=ClientTimeout(total=180))
        app = web.Application(middlewares=[self.authenticate], client_max_size=self.settings.maxMediaBytes)
        app.add_routes([
            web.post("/v1/sendExpression", self.send_expression),
            web.get("/v1/accounts", self.accounts),
            web.get("/v1/capabilities", self.capabilities),
            web.post("/v1/history", self.history),
        ])
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        await web.TCPSite(self.runner, self.settings.host, self.settings.port).start()

    async def terminate(self):
        if self.runner:
            await self.runner.cleanup()
        if self.http:
            await self.http.close()

    @web.middleware
    async def authenticate(self, request: web.Request, handler):
        if not hmac.compare_digest(request.headers.get("Authorization", ""), f"Bearer {self.control_token}"):
            raise web.HTTPUnauthorized()
        try:
            return await handler(request)
        except (ValidationError, ValueError) as error:
            raise web.HTTPBadRequest(text=str(error)) from error

    def find_scope(self, account: str, conversation: str) -> Scope:
        for scope in self.settings.scopes:
            if scope.account == account and scope.owns(conversation):
                return scope
        raise web.HTTPForbidden(text="Channel is outside the configured subject scope")

    def adapter(self, scope: Scope):
        adapter = self.context.get_platform_inst(scope.platformId)
        if adapter is None or adapter.meta().name != "aiocqhttp":
            raise web.HTTPServiceUnavailable(text="AstrBot OneBot adapter is unavailable")
        return adapter

    async def hept(self, scope: Scope, resource: str, **kwargs):
        assert self.http is not None
        headers = {"Authorization": f"Bearer {self.hept_token}", "x-purpose": "ingress", **kwargs.pop("headers", {})}
        async with self.http.post(
            f"{self.settings.heptURL.rstrip('/')}/v1/subjects/{scope.subjectId}/{resource}",
            headers=headers, **kwargs,
        ) as response:
            response.raise_for_status()
            return await response.json()

    @filter.event_message_type(filter.EventMessageType.ALL, priority=maxsize)
    async def receive(self, event: AstrMessageEvent):
        if event.get_platform_name() != "aiocqhttp":
            return
        account = f"{event.get_platform_id()}:{event.get_self_id()}"
        conversation = f"group:{event.get_group_id()}" if event.get_group_id() else f"private:{event.get_sender_id()}"
        try:
            scope = self.find_scope(account, conversation)
        except web.HTTPForbidden:
            return
        event.stop_event()
        raw = dict(event.message_obj.raw_message or {})
        await self.accept_raw(scope, conversation, raw, event.message_obj.message)

    async def preserve_media(self, scope: Scope, conversation: str, component, part: dict, source_key: str):
        try:
            path = await component.get_file() if isinstance(component, File) else await component.convert_to_file_path()
            size = await asyncio.to_thread(lambda: Path(path).stat().st_size)
            if size > self.settings.maxMediaBytes:
                part["availability"] = "too_large"
                return
            name = part.get("name") or Path(path).name
            media_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
            with open(path, "rb") as stream:
                material = await self.hept(scope, "media", params={"channelAccount": scope.account, "conversationKey": conversation}, data=stream, headers={"Content-Type": "application/octet-stream", "x-filename": name, "x-media-type": media_type, "idempotency-key": f"{source_key}:{part['partId']}"})
            part.update(materialRef=material["ref"], availability="available", mediaType=media_type)
            part.pop("url", None)
        except Exception as error:
            part.update(availability="missing", description="Media preservation unavailable")

    async def incoming_parts(self, scope: Scope, conversation: str, segments: list, native: list | None = None, prefix: str = "p", media_source_key: str = "") -> list[dict]:
        parts: list[dict] = []
        media = [component for component in native or [] if isinstance(component, (Image, Record, Video, File))]
        for index, segment in enumerate(segments):
            kind, data = segment.get("type", "unknown"), segment.get("data", {})
            part = {"partId": f"{prefix}{index}"}
            if kind == "text":
                part.update(kind="text", text=str(data.get("text", "")))
            elif kind == "at":
                part.update(kind="mention", accountId=str(data.get("qq", "")))
            elif kind == "reply":
                part.update(kind="reply", platformMessageId=str(data.get("id", "")), status="pending")
            elif kind in ("image", "record", "video", "file", "mface"):
                hept_kind = {"record": "audio", "mface": "sticker"}.get(kind, kind)
                part.update(kind=hept_kind, availability="pending")
                if data.get("url"):
                    part["url"] = data["url"]
                if data.get("name") or data.get("file_name"):
                    part["name"] = str(data.get("name") or data["file_name"])
                expected = {"image": Image, "sticker": Image, "audio": Record, "video": Video, "file": File}[hept_kind]
                component = None if kind == "mface" else next((value for value in media if isinstance(value, expected)), None)
                if component is not None:
                    media.remove(component)
                if component is None:
                    source = data.get("url") or data.get("file")
                    if source:
                        component = {"image": Image, "sticker": Image, "audio": Record, "video": Video, "file": lambda file: File(name=part.get("name", "file"), url=file)}[hept_kind](file=source)
                if component:
                    await self.preserve_media(scope, conversation, component, part, media_source_key)
                else:
                    part["availability"] = "missing"
            elif kind in ("forward", "node"):
                try:
                    if kind == "forward":
                        forwarded = await self.adapter(scope).bot.call_action("get_forward_msg", id=data["id"], self_id=scope.selfId)
                        nodes = forwarded.get("messages", [])
                    else:
                        nodes = [data]
                    part.update(kind="forward", nodes=[])
                    for node_index, node in enumerate(nodes):
                        sender = node.get("sender", {})
                        content = node.get("content", node.get("message", []))
                        if isinstance(content, str):
                            content = [{"type": "text", "data": {"text": content}}]
                        converted = {"nodeId": str(node.get("message_id", f"{part['partId']}n{node_index}")), "authorId": str(sender.get("user_id", node.get("user_id", "unknown"))), "authorName": sender.get("nickname", node.get("nickname", "")), "parts": await self.incoming_parts(scope, conversation, content, prefix=f"{part['partId']}n{node_index}p", media_source_key=media_source_key)}
                        if node.get("time"):
                            converted["sentAt"] = timepoint(node["time"])
                        part["nodes"].append(converted)
                except Exception as error:
                    part.update(kind="unsupported", description=f"Forward unavailable: {error}", raw=segment)
            else:
                part.update(kind="card" if kind in ("json", "xml", "face") else "unsupported", description=f"OneBot {kind}", raw=segment)
            parts.append(part)
        return parts

    async def accept_raw(self, scope: Scope, conversation: str, raw: dict, native: list | None = None):
        notice = raw.get("notice_type")
        changes = {"group_recall": "retract", "friend_recall": "retract", "message_edit": "edit", "message_update": "edit", "group_msg_emoji_like": "feedback"}
        if notice in changes and raw.get("message_id") is not None:
            change = {
                "source": {"channelAccount": scope.account, "conversationKey": conversation, "platformMessageId": str(raw["message_id"])},
                "kind": changes[notice],
                "sourceEventId": f"{scope.account}:{notice}:{raw['message_id']}:{raw.get('time', '')}:{raw.get('operator_id', raw.get('user_id', ''))}",
                "raw": raw,
            }
            if changes[notice] == "edit":
                change["parts"] = await self.incoming_parts(scope, conversation, raw.get("message", []), native, media_source_key=f"{scope.account}:{conversation}:{change['sourceEventId']}")
            return await self.hept(scope, "message-changes", json=change)
        message_id = str(raw.get("message_id") or raw.get("operator_id") or uuid4())
        parts = await self.incoming_parts(scope, conversation, raw.get("message", []), native, media_source_key=f"{scope.account}:{conversation}:{message_id}")
        if not parts:
            parts = [{"partId": "event", "kind": "unsupported", "description": f"OneBot {raw.get('notice_type', raw.get('post_type', 'event'))}", "raw": raw}]
        sender = raw.get("sender", {})
        return await self.hept(scope, "messages", json={
            "clientSubmissionId": f"{scope.account}:{raw.get('post_type', 'message')}:{message_id}",
            "conversationKey": conversation, "channelAccount": scope.account,
            "platformMessageId": message_id, "authorId": str(raw.get("user_id", "system")),
            "authorName": sender.get("card") or sender.get("nickname") or str(raw.get("user_id", "system")),
            "sentAt": timepoint(raw.get("time")), "parts": parts, "raw": raw,
        })

    async def outgoing_component(self, part: dict):
        kind = part["kind"]
        if kind == "text":
            return Plain(part["text"])
        if kind == "link":
            return Plain(f"{part.get('title', '')} {part['url']}".strip())
        if kind == "mention":
            return At(qq=part["accountId"], name=part.get("displayName", ""))
        if kind == "reply":
            return Reply(id=part["platformMessageId"])
        if kind == "forward":
            return Nodes([Node(content=[await self.outgoing_component(value) for value in node["parts"]], uin=node["authorId"], name=node.get("authorName", "")) for node in part["nodes"]])
        if kind in ("image", "sticker", "audio", "video", "file"):
            source = part.get("url")
            if not source:
                raise ValueError("Outgoing media requires an authorized URL supplied by Hept")
            if kind == "file":
                return File(name=part.get("name", "file"), url=source)
            return {"image": Image, "sticker": Image, "audio": Record, "video": Video}[kind](file=source)
        raw = part.get("raw")
        if kind == "card" and isinstance(raw, dict) and raw.get("type") == "json":
            return Json(raw.get("data", {}).get("data", {}))
        raise ValueError(f"No native outgoing component for {kind}")

    async def send_expression(self, request: web.Request):
        body = SendExpression.model_validate(await request.json())
        scope = self.find_scope(body.channelAccount, body.conversationKey)
        category, session_id = body.conversationKey.split(":", 1)
        if category not in ("group", "private") or not session_id.isdigit():
            raise ValueError("OneBot conversation must be group:<id> or private:<id>")
        parts = [part.model_dump(exclude_none=True) for part in body.parts]
        components = []
        for part in parts:
            components.append(await self.outgoing_component(part))
        receipts = await AiocqhttpMessageEvent.send_message(
            self.adapter(scope).bot, MessageChain(components),
            event=Event({"self_id": int(scope.selfId)}), is_group=category == "group", session_id=session_id, receipt_mode=True,
        )
        result = []
        for receipt in receipts:
            native = receipt.get("result")
            delivery = {"partId": str(uuid4()), "expressionPartRefs": [parts[index]["partId"] for index in receipt["component_indexes"]], "attemptedAt": {"domainId": "real", "at": receipt["attempted_at"]}, "status": receipt["status"]}
            if isinstance(native, dict) and native.get("message_id") is not None:
                delivery["platformMessageId"] = str(native["message_id"])
            if receipt.get("error"):
                delivery["error"] = receipt["error"]
            delivery["nativeReceiptRef"] = json.dumps({"action": receipt["action"], "result": native}, ensure_ascii=False, default=str)
            result.append(delivery)
        return web.json_response({"parts": result})

    async def accounts(self, request: web.Request):
        accounts = []
        for scope in self.settings.scopes:
            info = await self.adapter(scope).bot.call_action("get_login_info", self_id=scope.selfId)
            accounts.append({"adapterId": f"astrbot:{scope.platformId}", "accountId": scope.account, "subjectId": scope.subjectId, "conversations": scope.conversations, "native": info})
        return web.json_response({"accounts": accounts})

    async def capabilities(self, request: web.Request):
        return web.json_response({"host": "astrbot", "platform": "onebot11", "physicalReceipts": True, "history": "platform_public_api", "receiptStatus": ["accepted", "not_sent", "unknown"], "parts": ["text", "mention", "reply", "image", "sticker", "audio", "video", "file", "forward", "card"]})

    async def history(self, request: web.Request):
        body = await request.json()
        conversation = body["conversationKey"]
        scope = self.find_scope(body["channelAccount"], conversation)
        category, identifier = conversation.split(":", 1)
        action = "get_group_msg_history" if category == "group" else "get_friend_msg_history"
        params = {"group_id" if category == "group" else "user_id": int(identifier), "self_id": scope.selfId, "count": min(int(body.get("count", 100)), 1000)}
        if body.get("beforeMessageId"):
            params["message_seq"] = int(body["beforeMessageId"])
        native = await self.adapter(scope).bot.call_action(action, **params)
        operations = [await self.accept_raw(scope, conversation, message) for message in native.get("messages", [])]
        return web.json_response({"operations": operations, "range": {"requestedBefore": body.get("beforeMessageId"), "received": len(operations), "complete": False, "reason": "Platform history returns its available range"}})
