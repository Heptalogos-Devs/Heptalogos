import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from aiohttp import ClientSession, web
from aiohttp.test_utils import TestServer
from aiocqhttp import Event
from aiocqhttp.exceptions import ActionFailed
from astrbot.api.message_components import Image
from astrbot.api.platform import AstrBotMessage, MessageMember, MessageType, PlatformMetadata
from astrbot.core.platform.sources.aiocqhttp.aiocqhttp_message_event import AiocqhttpMessageEvent

package = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("hept_channel", package / "main.py", submodule_search_locations=[str(package)])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
HeptChannel = module.HeptChannel


@pytest.mark.asyncio
async def test_full_inbound_media_and_partial_physical_receipts(monkeypatch, tmp_path):
    received = []
    media = []
    changes = []

    async def message(request):
        received.append(await request.json())
        assert request.headers["Authorization"] == "Bearer service-test"
        assert request.headers["x-purpose"] == "ingress"
        return web.json_response({"operationId": "received"})

    async def preserve(request):
        media.append(await request.read())
        assert request.query == {"channelAccount": "qq:456", "conversationKey": "group:123"}
        assert request.headers["idempotency-key"] == "qq:456:group:123:99:p1"
        return web.json_response({"ref": {"product": "hept", "installationId": "test", "kind": "media", "id": "image"}, "bytes": len(media[-1]), "mediaType": "image/png", "name": "photo.png"})

    async def change(request):
        changes.append(await request.json())
        return web.json_response({"operationId": "changed"})

    app = web.Application()
    app.router.add_post("/v1/subjects/subject/messages", message)
    app.router.add_post("/v1/subjects/subject/media", preserve)
    app.router.add_post("/v1/subjects/subject/message-changes", change)
    server = TestServer(app)
    await server.start_server()
    monkeypatch.setenv("HEPT_SERVICE_TOKEN", "service-test")
    monkeypatch.setenv("HEPT_ASTRBOT_TOKEN", "control-test")

    class Bot:
        calls = []

        async def send_group_msg(self, **payload):
            self.calls.append(payload)
            if len(self.calls) == 2:
                raise ActionFailed({"retcode": 100, "wording": "file rejected"})
            return {"message_id": 100 + len(self.calls)}

        async def call_action(self, action, **payload):
            self.calls.append({"action": action, **payload})
            raise TimeoutError("Platform response was lost")

    bot = Bot()
    adapter = SimpleNamespace(bot=bot, meta=lambda: SimpleNamespace(name="aiocqhttp"))
    plugin = HeptChannel(SimpleNamespace(get_platform_inst=lambda identifier: adapter), {
        "heptURL": str(server.make_url("/")), "port": 0,
        "scopes": [{"subjectId": "subject", "platformId": "qq", "selfId": "456", "conversations": ["group:123"]}],
    })
    await plugin.initialize()
    try:
        image = tmp_path / "photo.png"
        image.write_bytes(b"actual source bytes")
        original = Event({"post_type": "message", "message_type": "group", "self_id": 456, "group_id": 123,
            "message_id": 99, "user_id": 789, "time": 1_760_000_000, "sender": {"nickname": "同学"},
            "message": [{"type": "text", "data": {"text": "看这张图"}},
                        {"type": "image", "data": {"file": str(image)}},
                        {"type": "reply", "data": {"id": "88"}},
                        {"type": "custom_card", "data": {"original": True}}]})
        native = AstrBotMessage()
        native.type = MessageType.GROUP_MESSAGE
        native.self_id = "456"
        native.group_id = "123"
        native.sender = MessageMember(user_id="789", nickname="同学")
        native.raw_message = original
        native.message = [Image(file=str(image))]
        event = AiocqhttpMessageEvent("看这张图", native, PlatformMetadata(name="aiocqhttp", description="", id="qq"), "123", bot)
        await plugin.receive(event)
        assert event.is_stopped()
        assert received[0]["platformMessageId"] == "99"
        assert [part["kind"] for part in received[0]["parts"]] == ["text", "image", "reply", "unsupported"]
        assert received[0]["parts"][1]["materialRef"]["id"] == "image"
        assert received[0]["raw"]["message"][-1]["data"]["original"] is True
        assert media == [b"actual source bytes"]
        assert image.exists()
        await plugin.accept_raw(plugin.settings.scopes[0], "group:123", {"post_type": "notice", "notice_type": "group_recall", "message_id": 99, "user_id": 789, "time": 1_760_000_001})
        assert changes[0]["kind"] == "retract"
        assert changes[0]["source"]["platformMessageId"] == "99"
        assert len(received) == 1

        address = plugin.runner.addresses[0]
        async with ClientSession() as client:
            async with client.post(f"http://127.0.0.1:{address[1]}/v1/sendExpression", headers={"Authorization": "Bearer control-test"}, json={
                "expressionId": "expression", "channelAccount": "qq:456", "conversationKey": "group:123", "parts": [
                    {"partId": "text", "kind": "text", "text": "收到"},
                    {"partId": "file", "kind": "file", "url": "https://example.test/file", "name": "note.txt"},
                    {"partId": "forward", "kind": "forward", "nodes": [{"nodeId": "n", "authorId": "456", "parts": [{"partId": "nested", "kind": "text", "text": "资料"}]}]},
                    {"partId": "last", "kind": "text", "text": "下一条"},
                ]}) as response:
                assert response.status == 200, await response.text()
                delivery = await response.json()
        assert [part["status"] for part in delivery["parts"]] == ["accepted", "not_sent", "unknown", "accepted"]
        assert [part["expressionPartRefs"] for part in delivery["parts"]] == [["text"], ["file"], ["forward"], ["last"]]
        assert delivery["parts"][0]["platformMessageId"] == "101"
        assert len(bot.calls) == 4
        assert all(str(call["self_id"]) == "456" for call in bot.calls)
    finally:
        await plugin.terminate()
        await server.close()
