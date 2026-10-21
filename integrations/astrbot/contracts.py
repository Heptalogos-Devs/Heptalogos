"""AstrBot boundary models matching @heptalogos/contracts messagePart."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TimePoint(Model):
    domainId: str = "real"
    at: str


class Ref(Model):
    product: str
    installationId: str
    subjectId: str | None = None
    kind: str
    id: str
    revision: int | None = None
    selector: Any | None = None


class Text(Model):
    partId: str
    kind: Literal["text"]
    text: str


class Mention(Model):
    partId: str
    kind: Literal["mention"]
    accountId: str
    displayName: str | None = None


class Reply(Model):
    partId: str
    kind: Literal["reply"]
    messageRef: Ref | None = None
    platformMessageId: str
    status: Literal["resolved", "unavailable", "pending"] = "pending"


class Media(Model):
    partId: str
    kind: Literal["image", "sticker", "audio", "video", "file"]
    materialRef: Ref | None = None
    url: str | None = None
    name: str | None = None
    mediaType: str | None = None
    description: str | None = None
    availability: Literal["pending", "available", "missing", "too_large"] = "pending"


class Link(Model):
    partId: str
    kind: Literal["link"]
    url: str
    title: str | None = None


class Card(Model):
    partId: str
    kind: Literal["card", "unsupported"]
    description: str
    raw: Any | None = None


class ForwardNode(Model):
    nodeId: str
    authorId: str
    authorName: str | None = None
    sentAt: TimePoint | None = None
    sourceRef: Ref | None = None
    parts: list[MessagePart]


class Forward(Model):
    partId: str
    kind: Literal["forward"]
    nodes: list[ForwardNode]


MessagePart = Annotated[
    Text | Mention | Reply | Media | Link | Card | Forward,
    Field(discriminator="kind"),
]
ForwardNode.model_rebuild()
Forward.model_rebuild()
message_part = TypeAdapter(MessagePart)


class SendExpression(Model):
    expressionId: str
    conversationKey: str
    channelAccount: str
    parts: list[MessagePart] = Field(min_length=1)


class Scope(Model):
    subjectId: str
    platformId: str
    selfId: str
    conversations: list[str] = Field(default_factory=lambda: ["*"])

    @property
    def account(self) -> str:
        return f"{self.platformId}:{self.selfId}"

    def owns(self, conversation: str) -> bool:
        return "*" in self.conversations or conversation in self.conversations


class Config(Model):
    heptURL: str
    heptTokenEnv: str = "HEPT_SERVICE_TOKEN"
    controlTokenEnv: str = "HEPT_ASTRBOT_TOKEN"
    host: str = "127.0.0.1"
    port: int = 8790
    maxMediaBytes: int = 52_428_800
    scopes: list[Scope]
