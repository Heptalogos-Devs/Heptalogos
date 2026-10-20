/* tslint:disable */
/* eslint-disable */
/**
 * 
 * @export
 * @interface ActivitiesInterruptRequest
 */
export interface ActivitiesInterruptRequest {
    /**
     * 
     */
    reason: string;
}
/**
 * 
 * @export
 * @interface Actor
 */
export interface Actor {
    /**
     * 
     */
    kind: ActorKindEnum;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    grants: Array<string>;
    /**
     * 
     */
    subjectIds?: Array<string>;
    /**
     * 
     */
    expiresAt?: string;
}


/**
 * @export
 */
export const ActorKindEnum = {
    Human: 'human',
    Subject: 'subject',
    Service: 'service',
    Worker: 'worker',
    Author: 'author',
} as const;
export type ActorKindEnum = typeof ActorKindEnum[keyof typeof ActorKindEnum];

/**
 * 
 * @export
 * @interface ActorInput
 */
export interface ActorInput {
    /**
     * 
     */
    kind: ActorInputKindEnum;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    grants: Array<string>;
    /**
     * 
     */
    subjectIds?: Array<string>;
    /**
     * 
     */
    expiresAt?: string;
}


/**
 * @export
 */
export const ActorInputKindEnum = {
    Human: 'human',
    Subject: 'subject',
    Service: 'service',
    Worker: 'worker',
    Author: 'author',
} as const;
export type ActorInputKindEnum = typeof ActorInputKindEnum[keyof typeof ActorInputKindEnum];

/**
 * 
 * @export
 * @interface CalendarChangeRequest
 */
export interface CalendarChangeRequest {
    /**
     * 
     */
    scope: CalendarChangeRequestScopeEnum;
    /**
     * 
     */
    originalStart?: string;
    /**
     * 
     */
    cancelled?: boolean;
    /**
     * 
     */
    rule?: WorldsPreviewRequestCalendarInner;
    /**
     * 
     */
    start?: string;
    /**
     * 
     */
    end?: string;
    /**
     * 
     */
    expectedRevision: number;
}


/**
 * @export
 */
export const CalendarChangeRequestScopeEnum = {
    This: 'this',
    Future: 'future',
    All: 'all',
} as const;
export type CalendarChangeRequestScopeEnum = typeof CalendarChangeRequestScopeEnum[keyof typeof CalendarChangeRequestScopeEnum];

/**
 * 
 * @export
 * @interface CallContext
 */
export interface CallContext {
    /**
     * 
     */
    actor: Actor;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    audience: Array<string>;
    /**
     * 
     */
    traceContext: CallContextTraceContext;
}
/**
 * 
 * @export
 * @interface CallContextInput
 */
export interface CallContextInput {
    /**
     * 
     */
    actor: ActorInput;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    audience: Array<string>;
    /**
     * 
     */
    traceContext: CallContextInputTraceContext;
}
/**
 * 
 * @export
 * @interface CallContextInputTraceContext
 */
export interface CallContextInputTraceContext {
    /**
     * 
     */
    traceId: string;
    /**
     * 
     */
    operationId: string;
    /**
     * 
     */
    traceparent?: string;
}
/**
 * 
 * @export
 * @interface CallContextTraceContext
 */
export interface CallContextTraceContext {
    /**
     * 
     */
    traceId: string;
    /**
     * 
     */
    operationId: string;
    /**
     * 
     */
    traceparent?: string;
}
/**
 * 
 * @export
 * @interface ChannelsConnectRequest
 */
export interface ChannelsConnectRequest {
    /**
     * 
     */
    host: ChannelsConnectRequestHostEnum;
    /**
     * 
     */
    accountId: string;
    /**
     * 
     */
    endpoint?: string;
    /**
     * 
     */
    credentialRef?: string;
    /**
     * 
     */
    conversationKeys?: Array<string>;
    /**
     * 
     */
    receive?: boolean;
    /**
     * 
     */
    participate?: boolean;
    /**
     * 
     */
    send?: boolean;
}


/**
 * @export
 */
export const ChannelsConnectRequestHostEnum = {
    Local: 'local',
    Astrbot: 'astrbot',
} as const;
export type ChannelsConnectRequestHostEnum = typeof ChannelsConnectRequestHostEnum[keyof typeof ChannelsConnectRequestHostEnum];

/**
 * 
 * @export
 * @interface CommitmentsEvaluateRequest
 */
export interface CommitmentsEvaluateRequest {
    /**
     * 
     */
    status: CommitmentsEvaluateRequestStatusEnum;
    /**
     * 
     */
    basisRefs: Array<RefInput>;
    /**
     * 
     */
    coverage: string;
}


/**
 * @export
 */
export const CommitmentsEvaluateRequestStatusEnum = {
    Fulfilled: 'fulfilled',
    Breached: 'breached',
    Released: 'released',
    Unknown: 'unknown',
} as const;
export type CommitmentsEvaluateRequestStatusEnum = typeof CommitmentsEvaluateRequestStatusEnum[keyof typeof CommitmentsEvaluateRequestStatusEnum];

/**
 * 
 * @export
 * @interface Consumer
 */
export interface Consumer {
    /**
     * 
     */
    kind: ConsumerKindEnum;
    /**
     * 
     */
    host: string;
    /**
     * 
     */
    id: string;
}


/**
 * @export
 */
export const ConsumerKindEnum = {
    Subject: 'subject',
    Worker: 'worker',
    Author: 'author',
    Maintenance: 'maintenance',
} as const;
export type ConsumerKindEnum = typeof ConsumerKindEnum[keyof typeof ConsumerKindEnum];

/**
 * 
 * @export
 * @interface ConsumerInput
 */
export interface ConsumerInput {
    /**
     * 
     */
    kind: ConsumerInputKindEnum;
    /**
     * 
     */
    host: string;
    /**
     * 
     */
    id: string;
}


/**
 * @export
 */
export const ConsumerInputKindEnum = {
    Subject: 'subject',
    Worker: 'worker',
    Author: 'author',
    Maintenance: 'maintenance',
} as const;
export type ConsumerInputKindEnum = typeof ConsumerInputKindEnum[keyof typeof ConsumerInputKindEnum];

/**
 * 
 * @export
 * @interface EffectsResolveRequest
 */
export interface EffectsResolveRequest {
    /**
     * 
     */
    status: EffectsResolveRequestStatusEnum;
    /**
     * 
     */
    platformMessageId?: string;
    /**
     * 
     */
    basis: string;
}


/**
 * @export
 */
export const EffectsResolveRequestStatusEnum = {
    Accepted: 'accepted',
    NotSent: 'not_sent',
} as const;
export type EffectsResolveRequestStatusEnum = typeof EffectsResolveRequestStatusEnum[keyof typeof EffectsResolveRequestStatusEnum];

/**
 * @type HeptMessagePart
 * 
 * @export
 */
export type HeptMessagePart = HeptMessagePartOneOf | HeptMessagePartOneOf1 | HeptMessagePartOneOf2 | HeptMessagePartOneOf3 | HeptMessagePartOneOf4 | HeptMessagePartOneOf5 | HeptMessagePartOneOf6;
/**
 * @type HeptMessagePartInput
 * 
 * @export
 */
export type HeptMessagePartInput = HeptMessagePartInputOneOf | HeptMessagePartInputOneOf1 | HeptMessagePartInputOneOf2 | HeptMessagePartInputOneOf3 | HeptMessagePartInputOneOf4 | HeptMessagePartInputOneOf5 | HeptMessagePartInputOneOf6;
/**
 * 
 * @export
 * @interface HeptMessagePartInputOneOf
 */
export interface HeptMessagePartInputOneOf {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartInputOneOfKindEnum;
    /**
     * 
     */
    text: string;
}


/**
 * @export
 */
export const HeptMessagePartInputOneOfKindEnum = {
    Text: 'text',
} as const;
export type HeptMessagePartInputOneOfKindEnum = typeof HeptMessagePartInputOneOfKindEnum[keyof typeof HeptMessagePartInputOneOfKindEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartInputOneOf1
 */
export interface HeptMessagePartInputOneOf1 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartInputOneOf1KindEnum;
    /**
     * 
     */
    accountId: string;
    /**
     * 
     */
    displayName?: string;
}


/**
 * @export
 */
export const HeptMessagePartInputOneOf1KindEnum = {
    Mention: 'mention',
} as const;
export type HeptMessagePartInputOneOf1KindEnum = typeof HeptMessagePartInputOneOf1KindEnum[keyof typeof HeptMessagePartInputOneOf1KindEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartInputOneOf2
 */
export interface HeptMessagePartInputOneOf2 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartInputOneOf2KindEnum;
    /**
     * 
     */
    messageRef?: RefInput;
    /**
     * 
     */
    platformMessageId: string;
    /**
     * 
     */
    status?: HeptMessagePartInputOneOf2StatusEnum;
}


/**
 * @export
 */
export const HeptMessagePartInputOneOf2KindEnum = {
    Reply: 'reply',
} as const;
export type HeptMessagePartInputOneOf2KindEnum = typeof HeptMessagePartInputOneOf2KindEnum[keyof typeof HeptMessagePartInputOneOf2KindEnum];

/**
 * @export
 */
export const HeptMessagePartInputOneOf2StatusEnum = {
    Resolved: 'resolved',
    Unavailable: 'unavailable',
    Pending: 'pending',
} as const;
export type HeptMessagePartInputOneOf2StatusEnum = typeof HeptMessagePartInputOneOf2StatusEnum[keyof typeof HeptMessagePartInputOneOf2StatusEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartInputOneOf3
 */
export interface HeptMessagePartInputOneOf3 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartInputOneOf3KindEnum;
    /**
     * 
     */
    materialRef?: RefInput;
    /**
     * 
     */
    url?: string;
    /**
     * 
     */
    name?: string;
    /**
     * 
     */
    mediaType?: string;
    /**
     * 
     */
    description?: string;
    /**
     * 
     */
    availability?: HeptMessagePartInputOneOf3AvailabilityEnum;
}


/**
 * @export
 */
export const HeptMessagePartInputOneOf3KindEnum = {
    Image: 'image',
    Sticker: 'sticker',
    Audio: 'audio',
    Video: 'video',
    File: 'file',
} as const;
export type HeptMessagePartInputOneOf3KindEnum = typeof HeptMessagePartInputOneOf3KindEnum[keyof typeof HeptMessagePartInputOneOf3KindEnum];

/**
 * @export
 */
export const HeptMessagePartInputOneOf3AvailabilityEnum = {
    Pending: 'pending',
    Available: 'available',
    Missing: 'missing',
    TooLarge: 'too_large',
} as const;
export type HeptMessagePartInputOneOf3AvailabilityEnum = typeof HeptMessagePartInputOneOf3AvailabilityEnum[keyof typeof HeptMessagePartInputOneOf3AvailabilityEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartInputOneOf4
 */
export interface HeptMessagePartInputOneOf4 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartInputOneOf4KindEnum;
    /**
     * 
     */
    url: string;
    /**
     * 
     */
    title?: string;
}


/**
 * @export
 */
export const HeptMessagePartInputOneOf4KindEnum = {
    Link: 'link',
} as const;
export type HeptMessagePartInputOneOf4KindEnum = typeof HeptMessagePartInputOneOf4KindEnum[keyof typeof HeptMessagePartInputOneOf4KindEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartInputOneOf5
 */
export interface HeptMessagePartInputOneOf5 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartInputOneOf5KindEnum;
    /**
     * 
     */
    description: string;
    /**
     * 
     */
    raw?: any | null;
}


/**
 * @export
 */
export const HeptMessagePartInputOneOf5KindEnum = {
    Card: 'card',
    Unsupported: 'unsupported',
} as const;
export type HeptMessagePartInputOneOf5KindEnum = typeof HeptMessagePartInputOneOf5KindEnum[keyof typeof HeptMessagePartInputOneOf5KindEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartInputOneOf6
 */
export interface HeptMessagePartInputOneOf6 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartInputOneOf6KindEnum;
    /**
     * 
     */
    nodes: Array<HeptMessagePartInputOneOf6NodesInner>;
}


/**
 * @export
 */
export const HeptMessagePartInputOneOf6KindEnum = {
    Forward: 'forward',
} as const;
export type HeptMessagePartInputOneOf6KindEnum = typeof HeptMessagePartInputOneOf6KindEnum[keyof typeof HeptMessagePartInputOneOf6KindEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartInputOneOf6NodesInner
 */
export interface HeptMessagePartInputOneOf6NodesInner {
    /**
     * 
     */
    nodeId: string;
    /**
     * 
     */
    authorId: string;
    /**
     * 
     */
    authorName?: string;
    /**
     * 
     */
    sentAt?: TimePointInput;
    /**
     * 
     */
    sourceRef?: RefInput;
    /**
     * 
     */
    parts: Array<HeptMessagePartInput>;
}
/**
 * 
 * @export
 * @interface HeptMessagePartOneOf
 */
export interface HeptMessagePartOneOf {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartOneOfKindEnum;
    /**
     * 
     */
    text: string;
}


/**
 * @export
 */
export const HeptMessagePartOneOfKindEnum = {
    Text: 'text',
} as const;
export type HeptMessagePartOneOfKindEnum = typeof HeptMessagePartOneOfKindEnum[keyof typeof HeptMessagePartOneOfKindEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartOneOf1
 */
export interface HeptMessagePartOneOf1 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartOneOf1KindEnum;
    /**
     * 
     */
    accountId: string;
    /**
     * 
     */
    displayName?: string;
}


/**
 * @export
 */
export const HeptMessagePartOneOf1KindEnum = {
    Mention: 'mention',
} as const;
export type HeptMessagePartOneOf1KindEnum = typeof HeptMessagePartOneOf1KindEnum[keyof typeof HeptMessagePartOneOf1KindEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartOneOf2
 */
export interface HeptMessagePartOneOf2 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartOneOf2KindEnum;
    /**
     * 
     */
    messageRef?: Ref;
    /**
     * 
     */
    platformMessageId: string;
    /**
     * 
     */
    status: HeptMessagePartOneOf2StatusEnum;
}


/**
 * @export
 */
export const HeptMessagePartOneOf2KindEnum = {
    Reply: 'reply',
} as const;
export type HeptMessagePartOneOf2KindEnum = typeof HeptMessagePartOneOf2KindEnum[keyof typeof HeptMessagePartOneOf2KindEnum];

/**
 * @export
 */
export const HeptMessagePartOneOf2StatusEnum = {
    Resolved: 'resolved',
    Unavailable: 'unavailable',
    Pending: 'pending',
} as const;
export type HeptMessagePartOneOf2StatusEnum = typeof HeptMessagePartOneOf2StatusEnum[keyof typeof HeptMessagePartOneOf2StatusEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartOneOf3
 */
export interface HeptMessagePartOneOf3 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartOneOf3KindEnum;
    /**
     * 
     */
    materialRef?: Ref;
    /**
     * 
     */
    url?: string;
    /**
     * 
     */
    name?: string;
    /**
     * 
     */
    mediaType?: string;
    /**
     * 
     */
    description?: string;
    /**
     * 
     */
    availability: HeptMessagePartOneOf3AvailabilityEnum;
}


/**
 * @export
 */
export const HeptMessagePartOneOf3KindEnum = {
    Image: 'image',
    Sticker: 'sticker',
    Audio: 'audio',
    Video: 'video',
    File: 'file',
} as const;
export type HeptMessagePartOneOf3KindEnum = typeof HeptMessagePartOneOf3KindEnum[keyof typeof HeptMessagePartOneOf3KindEnum];

/**
 * @export
 */
export const HeptMessagePartOneOf3AvailabilityEnum = {
    Pending: 'pending',
    Available: 'available',
    Missing: 'missing',
    TooLarge: 'too_large',
} as const;
export type HeptMessagePartOneOf3AvailabilityEnum = typeof HeptMessagePartOneOf3AvailabilityEnum[keyof typeof HeptMessagePartOneOf3AvailabilityEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartOneOf4
 */
export interface HeptMessagePartOneOf4 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartOneOf4KindEnum;
    /**
     * 
     */
    url: string;
    /**
     * 
     */
    title?: string;
}


/**
 * @export
 */
export const HeptMessagePartOneOf4KindEnum = {
    Link: 'link',
} as const;
export type HeptMessagePartOneOf4KindEnum = typeof HeptMessagePartOneOf4KindEnum[keyof typeof HeptMessagePartOneOf4KindEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartOneOf5
 */
export interface HeptMessagePartOneOf5 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartOneOf5KindEnum;
    /**
     * 
     */
    description: string;
    /**
     * 
     */
    raw?: any | null;
}


/**
 * @export
 */
export const HeptMessagePartOneOf5KindEnum = {
    Card: 'card',
    Unsupported: 'unsupported',
} as const;
export type HeptMessagePartOneOf5KindEnum = typeof HeptMessagePartOneOf5KindEnum[keyof typeof HeptMessagePartOneOf5KindEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartOneOf6
 */
export interface HeptMessagePartOneOf6 {
    /**
     * 
     */
    partId: string;
    /**
     * 
     */
    kind: HeptMessagePartOneOf6KindEnum;
    /**
     * 
     */
    nodes: Array<HeptMessagePartOneOf6NodesInner>;
}


/**
 * @export
 */
export const HeptMessagePartOneOf6KindEnum = {
    Forward: 'forward',
} as const;
export type HeptMessagePartOneOf6KindEnum = typeof HeptMessagePartOneOf6KindEnum[keyof typeof HeptMessagePartOneOf6KindEnum];

/**
 * 
 * @export
 * @interface HeptMessagePartOneOf6NodesInner
 */
export interface HeptMessagePartOneOf6NodesInner {
    /**
     * 
     */
    nodeId: string;
    /**
     * 
     */
    authorId: string;
    /**
     * 
     */
    authorName?: string;
    /**
     * 
     */
    sentAt?: TimePoint;
    /**
     * 
     */
    sourceRef?: Ref;
    /**
     * 
     */
    parts: Array<HeptMessagePart>;
}
/**
 * 
 * @export
 * @interface MessagesChangeRequest
 */
export interface MessagesChangeRequest {
    /**
     * 
     */
    kind: MessagesChangeRequestKindEnum;
    /**
     * 
     */
    parts?: Array<HeptMessagePartInput>;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    sourceEventId: string;
}


/**
 * @export
 */
export const MessagesChangeRequestKindEnum = {
    Edit: 'edit',
    Retract: 'retract',
    Feedback: 'feedback',
} as const;
export type MessagesChangeRequestKindEnum = typeof MessagesChangeRequestKindEnum[keyof typeof MessagesChangeRequestKindEnum];

/**
 * 
 * @export
 * @interface MessagesReceiveRequest
 */
export interface MessagesReceiveRequest {
    /**
     * 
     */
    clientSubmissionId: string;
    /**
     * 
     */
    conversationId?: string;
    /**
     * 
     */
    conversationKey: string;
    /**
     * 
     */
    channelAccount?: string;
    /**
     * 
     */
    platformMessageId: string;
    /**
     * 
     */
    authorId: string;
    /**
     * 
     */
    authorName?: string;
    /**
     * 
     */
    sentAt?: TimePointInput;
    /**
     * 
     */
    parts: Array<HeptMessagePartInput>;
    /**
     * 
     */
    raw?: any | null;
    /**
     * 
     */
    policy?: PolicyInput;
}
/**
 * 
 * @export
 * @interface MessagesSendExpressionRequest
 */
export interface MessagesSendExpressionRequest {
    /**
     * 
     */
    intent: MessagesSendExpressionRequestIntent;
    /**
     * 
     */
    parts: Array<HeptMessagePartInput>;
    /**
     * 
     */
    clientSubmissionId: string;
}
/**
 * 
 * @export
 * @interface MessagesSendExpressionRequestIntent
 */
export interface MessagesSendExpressionRequestIntent {
    /**
     * 
     */
    conversationId: string;
    /**
     * 
     */
    audience: Array<string>;
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    posture?: string;
    /**
     * 
     */
    facts?: Array<string>;
    /**
     * 
     */
    sourceRefs?: Array<RefInput>;
    /**
     * 
     */
    commitment?: MessagesSendExpressionRequestIntentCommitment;
}
/**
 * 
 * @export
 * @interface MessagesSendExpressionRequestIntentCommitment
 */
export interface MessagesSendExpressionRequestIntentCommitment {
    /**
     * 
     */
    terms: string;
    /**
     * 
     */
    dueAt?: TimePointInput;
}
/**
 * 
 * @export
 * @interface ModelsRegisterRequest
 */
export interface ModelsRegisterRequest {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    provider: ModelsRegisterRequestProviderEnum;
    /**
     * 
     */
    baseURL: string;
    /**
     * 
     */
    modelId: string;
    /**
     * 
     */
    credentialRef: string;
    /**
     * 
     */
    contextLimit?: number;
    /**
     * 
     */
    outputLimit?: number;
    /**
     * 
     */
    pricing?: ModelsRegisterRequestPricing;
    /**
     * 
     */
    capabilities?: Array<string>;
    /**
     * 
     */
    providerOptions?: { [key: string]: any; };
}


/**
 * @export
 */
export const ModelsRegisterRequestProviderEnum = {
    OpenaiCompatible: 'openai-compatible',
} as const;
export type ModelsRegisterRequestProviderEnum = typeof ModelsRegisterRequestProviderEnum[keyof typeof ModelsRegisterRequestProviderEnum];

/**
 * 
 * @export
 * @interface ModelsRegisterRequestPricing
 */
export interface ModelsRegisterRequestPricing {
    /**
     * 
     */
    inputPerMillion: number;
    /**
     * 
     */
    outputPerMillion: number;
}
/**
 * 
 * @export
 * @interface OperationRef
 */
export interface OperationRef {
    /**
     * 
     */
    operationId: string;
    /**
     * 
     */
    statusUrl: string;
    /**
     * 
     */
    resourceRef?: Ref;
}
/**
 * 
 * @export
 * @interface OperationRefInput
 */
export interface OperationRefInput {
    /**
     * 
     */
    operationId: string;
    /**
     * 
     */
    statusUrl: string;
    /**
     * 
     */
    resourceRef?: RefInput;
}
/**
 * 
 * @export
 * @interface Policy
 */
export interface Policy {
    /**
     * 
     */
    readers: Array<string>;
    /**
     * 
     */
    purposes: Array<string>;
    /**
     * 
     */
    audiences: Array<string>;
}
/**
 * 
 * @export
 * @interface PolicyInput
 */
export interface PolicyInput {
    /**
     * 
     */
    readers: Array<string>;
    /**
     * 
     */
    purposes: Array<string>;
    /**
     * 
     */
    audiences: Array<string>;
}
/**
 * 
 * @export
 * @interface Problem
 */
export interface Problem {
    /**
     * 
     */
    type: string;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    status: number;
    /**
     * 
     */
    detail?: string;
    /**
     * 
     */
    code: ProblemCodeEnum;
    /**
     * 
     */
    operationId?: string;
    /**
     * 
     */
    currentRevision?: number;
    /**
     * 
     */
    retryAfter?: number;
}


/**
 * @export
 */
export const ProblemCodeEnum = {
    InvalidInput: 'invalid_input',
    Forbidden: 'forbidden',
    NotFound: 'not_found',
    Conflict: 'conflict',
    CapabilityUnavailable: 'capability_unavailable',
    BudgetExhausted: 'budget_exhausted',
    DependencyUnavailable: 'dependency_unavailable',
    EffectUnknown: 'effect_unknown',
} as const;
export type ProblemCodeEnum = typeof ProblemCodeEnum[keyof typeof ProblemCodeEnum];

/**
 * 
 * @export
 * @interface ProblemInput
 */
export interface ProblemInput {
    /**
     * 
     */
    type: string;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    status: number;
    /**
     * 
     */
    detail?: string;
    /**
     * 
     */
    code: ProblemInputCodeEnum;
    /**
     * 
     */
    operationId?: string;
    /**
     * 
     */
    currentRevision?: number;
    /**
     * 
     */
    retryAfter?: number;
}


/**
 * @export
 */
export const ProblemInputCodeEnum = {
    InvalidInput: 'invalid_input',
    Forbidden: 'forbidden',
    NotFound: 'not_found',
    Conflict: 'conflict',
    CapabilityUnavailable: 'capability_unavailable',
    BudgetExhausted: 'budget_exhausted',
    DependencyUnavailable: 'dependency_unavailable',
    EffectUnknown: 'effect_unknown',
} as const;
export type ProblemInputCodeEnum = typeof ProblemInputCodeEnum[keyof typeof ProblemInputCodeEnum];

/**
 * 
 * @export
 * @interface PursuitsCreateRequest
 */
export interface PursuitsCreateRequest {
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    plan: string;
    /**
     * 
     */
    motivationRefs?: Array<RefInput>;
    /**
     * 
     */
    reviewAt?: TimePointInput;
    /**
     * 
     */
    status?: PursuitsCreateRequestStatusEnum;
}


/**
 * @export
 */
export const PursuitsCreateRequestStatusEnum = {
    Active: 'active',
    Paused: 'paused',
    Completed: 'completed',
    Abandoned: 'abandoned',
} as const;
export type PursuitsCreateRequestStatusEnum = typeof PursuitsCreateRequestStatusEnum[keyof typeof PursuitsCreateRequestStatusEnum];

/**
 * 
 * @export
 * @interface Ref
 */
export interface Ref {
    /**
     * 
     */
    product: RefProductEnum;
    /**
     * 
     */
    installationId: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    kind: string;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    revision?: number;
    /**
     * 
     */
    selector?: Selector;
}


/**
 * @export
 */
export const RefProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type RefProductEnum = typeof RefProductEnum[keyof typeof RefProductEnum];

/**
 * 
 * @export
 * @interface RefInput
 */
export interface RefInput {
    /**
     * 
     */
    product: RefInputProductEnum;
    /**
     * 
     */
    installationId: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    kind: string;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    revision?: number;
    /**
     * 
     */
    selector?: SelectorInput;
}


/**
 * @export
 */
export const RefInputProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type RefInputProductEnum = typeof RefInputProductEnum[keyof typeof RefInputProductEnum];

/**
 * 
 * @export
 * @interface SecretsSetRequest
 */
export interface SecretsSetRequest {
    /**
     * 
     */
    value: string;
}
/**
 * 
 * @export
 * @interface Selector
 */
export interface Selector {
    /**
     * 
     */
    kind: SelectorKindEnum;
    /**
     * 
     */
    start?: number;
    /**
     * 
     */
    end?: number;
    /**
     * 
     */
    page?: number;
    /**
     * 
     */
    partId?: string;
    /**
     * 
     */
    nodeId?: string;
    /**
     * 
     */
    x?: number;
    /**
     * 
     */
    y?: number;
    /**
     * 
     */
    width?: number;
    /**
     * 
     */
    height?: number;
    /**
     * 
     */
    within?: Selector;
}


/**
 * @export
 */
export const SelectorKindEnum = {
    Text: 'text',
    Page: 'page',
    Image: 'image',
    Media: 'media',
    Part: 'part',
    Node: 'node',
} as const;
export type SelectorKindEnum = typeof SelectorKindEnum[keyof typeof SelectorKindEnum];

/**
 * 
 * @export
 * @interface SelectorInput
 */
export interface SelectorInput {
    /**
     * 
     */
    kind: SelectorInputKindEnum;
    /**
     * 
     */
    start?: number;
    /**
     * 
     */
    end?: number;
    /**
     * 
     */
    page?: number;
    /**
     * 
     */
    partId?: string;
    /**
     * 
     */
    nodeId?: string;
    /**
     * 
     */
    x?: number;
    /**
     * 
     */
    y?: number;
    /**
     * 
     */
    width?: number;
    /**
     * 
     */
    height?: number;
    /**
     * 
     */
    within?: SelectorInput;
}


/**
 * @export
 */
export const SelectorInputKindEnum = {
    Text: 'text',
    Page: 'page',
    Image: 'image',
    Media: 'media',
    Part: 'part',
    Node: 'node',
} as const;
export type SelectorInputKindEnum = typeof SelectorInputKindEnum[keyof typeof SelectorInputKindEnum];

/**
 * 
 * @export
 * @interface SettingsResetRequest
 */
export interface SettingsResetRequest {
    /**
     * 
     */
    scope: string;
}
/**
 * 
 * @export
 * @interface SettingsUpdateRequest
 */
export interface SettingsUpdateRequest {
    /**
     * 
     */
    scope: SettingsUpdateRequestScopeEnum;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    role?: string;
    /**
     * 
     */
    values: { [key: string]: any; };
    /**
     * 
     */
    expectedRevision?: number;
}


/**
 * @export
 */
export const SettingsUpdateRequestScopeEnum = {
    Installation: 'installation',
    Subject: 'subject',
    Role: 'role',
} as const;
export type SettingsUpdateRequestScopeEnum = typeof SettingsUpdateRequestScopeEnum[keyof typeof SettingsUpdateRequestScopeEnum];

/**
 * 
 * @export
 * @interface SubjectsBindRequest
 */
export interface SubjectsBindRequest {
    /**
     * 
     */
    installationId: string;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    baseURL: string;
    /**
     * 
     */
    credentialRef: string;
}
/**
 * 
 * @export
 * @interface SubjectsCreateRequest
 */
export interface SubjectsCreateRequest {
    /**
     * 
     */
    id?: string;
    /**
     * 
     */
    displayName: string;
    /**
     * 
     */
    roleMaterial?: string;
    /**
     * 
     */
    capabilities?: Array<string>;
    /**
     * 
     */
    clientSubmissionId: string;
}
/**
 * 
 * @export
 * @interface SubjectsForkRequest
 */
export interface SubjectsForkRequest {
    /**
     * 
     */
    displayName: string;
}
/**
 * 
 * @export
 * @interface TasksStartRequest
 */
export interface TasksStartRequest {
    /**
     * 
     */
    clientSubmissionId: string;
    /**
     * 
     */
    goal: string;
    /**
     * 
     */
    pursuitRef?: RefInput;
    /**
     * 
     */
    activityRef?: RefInput;
    /**
     * 
     */
    workContextId?: string;
    /**
     * 
     */
    inputRefs?: Array<RefInput>;
    /**
     * 
     */
    allowedTools?: Array<string>;
    /**
     * 
     */
    workspaceRef?: string;
    /**
     * 
     */
    budget?: number;
    /**
     * 
     */
    returnTarget?: TasksStartRequestReturnTarget;
}
/**
 * 
 * @export
 * @interface TasksStartRequestReturnTarget
 */
export interface TasksStartRequestReturnTarget {
    /**
     * 
     */
    conversationId?: string;
    /**
     * 
     */
    messageId?: string;
}
/**
 * 
 * @export
 * @interface TimePoint
 */
export interface TimePoint {
    /**
     * 
     */
    clockId: string;
    /**
     * 
     */
    at: string;
}
/**
 * 
 * @export
 * @interface TimePointInput
 */
export interface TimePointInput {
    /**
     * 
     */
    clockId: string;
    /**
     * 
     */
    at: string;
}
/**
 * 
 * @export
 * @interface TimeRange
 */
export interface TimeRange {
    /**
     * 
     */
    start?: TimePoint;
    /**
     * 
     */
    end?: TimePoint;
}
/**
 * 
 * @export
 * @interface TimeRangeInput
 */
export interface TimeRangeInput {
    /**
     * 
     */
    start?: TimePointInput;
    /**
     * 
     */
    end?: TimePointInput;
}
/**
 * 
 * @export
 * @interface WorldActRequest
 */
export interface WorldActRequest {
    /**
     * 
     */
    kind: WorldActRequestKindEnum;
    /**
     * 
     */
    target: string;
    /**
     * 
     */
    minutes?: number;
}


/**
 * @export
 */
export const WorldActRequestKindEnum = {
    Move: 'move',
    Rest: 'rest',
    Participate: 'participate',
    Talk: 'talk',
} as const;
export type WorldActRequestKindEnum = typeof WorldActRequestKindEnum[keyof typeof WorldActRequestKindEnum];

/**
 * 
 * @export
 * @interface WorldAdvanceToRequest
 */
export interface WorldAdvanceToRequest {
    /**
     * 
     */
    target?: string;
}
/**
 * 
 * @export
 * @interface WorldClockUpdateRequest
 */
export interface WorldClockUpdateRequest {
    /**
     * 
     */
    rate?: number;
    /**
     * 
     */
    paused?: boolean;
    /**
     * 
     */
    timezone?: string;
    /**
     * 
     */
    offlinePolicy?: WorldClockUpdateRequestOfflinePolicyEnum;
}


/**
 * @export
 */
export const WorldClockUpdateRequestOfflinePolicyEnum = {
    Freeze: 'freeze',
    CatchUp: 'catch_up',
} as const;
export type WorldClockUpdateRequestOfflinePolicyEnum = typeof WorldClockUpdateRequestOfflinePolicyEnum[keyof typeof WorldClockUpdateRequestOfflinePolicyEnum];

/**
 * 
 * @export
 * @interface WorldsPreviewRequest
 */
export interface WorldsPreviewRequest {
    /**
     * 
     */
    formatVersion: WorldsPreviewRequestFormatVersionEnum;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    background: string;
    /**
     * 
     */
    rules?: string;
    /**
     * 
     */
    clock: WorldsPreviewRequestClock;
    /**
     * 
     */
    entryPoint: string;
    /**
     * 
     */
    places: Array<WorldsPreviewRequestPlacesInner>;
    /**
     * 
     */
    characters?: Array<WorldsPreviewRequestCharactersInner>;
    /**
     * 
     */
    calendar?: Array<WorldsPreviewRequestCalendarInner>;
}


/**
 * @export
 */
export const WorldsPreviewRequestFormatVersionEnum = {
    NUMBER_1: 1,
} as const;
export type WorldsPreviewRequestFormatVersionEnum = typeof WorldsPreviewRequestFormatVersionEnum[keyof typeof WorldsPreviewRequestFormatVersionEnum];

/**
 * 
 * @export
 * @interface WorldsPreviewRequestCalendarInner
 */
export interface WorldsPreviewRequestCalendarInner {
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    start: string;
    /**
     * 
     */
    timezone: string;
    /**
     * 
     */
    durationMinutes: number;
    /**
     * 
     */
    rrule?: string;
    /**
     * 
     */
    placeId?: string;
    /**
     * 
     */
    characterId?: string;
    /**
     * 
     */
    adherence?: WorldsPreviewRequestCalendarInnerAdherenceEnum;
    /**
     * 
     */
    activityKind?: WorldsPreviewRequestCalendarInnerActivityKindEnum;
    /**
     * 
     */
    interruptibility?: WorldsPreviewRequestCalendarInnerInterruptibilityEnum;
}


/**
 * @export
 */
export const WorldsPreviewRequestCalendarInnerAdherenceEnum = {
    Free: 'free',
    Expected: 'expected',
    Binding: 'binding',
} as const;
export type WorldsPreviewRequestCalendarInnerAdherenceEnum = typeof WorldsPreviewRequestCalendarInnerAdherenceEnum[keyof typeof WorldsPreviewRequestCalendarInnerAdherenceEnum];

/**
 * @export
 */
export const WorldsPreviewRequestCalendarInnerActivityKindEnum = {
    Sleep: 'sleep',
    Rest: 'rest',
    Study: 'study',
    Exercise: 'exercise',
    Social: 'social',
    Travel: 'travel',
    Other: 'other',
} as const;
export type WorldsPreviewRequestCalendarInnerActivityKindEnum = typeof WorldsPreviewRequestCalendarInnerActivityKindEnum[keyof typeof WorldsPreviewRequestCalendarInnerActivityKindEnum];

/**
 * @export
 */
export const WorldsPreviewRequestCalendarInnerInterruptibilityEnum = {
    Open: 'open',
    Glance: 'glance',
    Brief: 'brief',
    Closed: 'closed',
} as const;
export type WorldsPreviewRequestCalendarInnerInterruptibilityEnum = typeof WorldsPreviewRequestCalendarInnerInterruptibilityEnum[keyof typeof WorldsPreviewRequestCalendarInnerInterruptibilityEnum];

/**
 * 
 * @export
 * @interface WorldsPreviewRequestCharactersInner
 */
export interface WorldsPreviewRequestCharactersInner {
    /**
     * 
     */
    key: string;
    /**
     * 
     */
    name: string;
    /**
     * 
     */
    description: string;
    /**
     * 
     */
    place: string;
    /**
     * 
     */
    privateNotes?: string;
}
/**
 * 
 * @export
 * @interface WorldsPreviewRequestClock
 */
export interface WorldsPreviewRequestClock {
    /**
     * 
     */
    worldAnchor: string;
    /**
     * 
     */
    rate?: number;
    /**
     * 
     */
    timezone?: string;
    /**
     * 
     */
    offlinePolicy?: WorldsPreviewRequestClockOfflinePolicyEnum;
}


/**
 * @export
 */
export const WorldsPreviewRequestClockOfflinePolicyEnum = {
    Freeze: 'freeze',
    CatchUp: 'catch_up',
} as const;
export type WorldsPreviewRequestClockOfflinePolicyEnum = typeof WorldsPreviewRequestClockOfflinePolicyEnum[keyof typeof WorldsPreviewRequestClockOfflinePolicyEnum];

/**
 * 
 * @export
 * @interface WorldsPreviewRequestPlacesInner
 */
export interface WorldsPreviewRequestPlacesInner {
    /**
     * 
     */
    key: string;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    description: string;
    /**
     * 
     */
    neighbors?: Array<WorldsPreviewRequestPlacesInnerNeighborsInner>;
    /**
     * 
     */
    devices?: Array<string>;
}
/**
 * 
 * @export
 * @interface WorldsPreviewRequestPlacesInnerNeighborsInner
 */
export interface WorldsPreviewRequestPlacesInnerNeighborsInner {
    /**
     * 
     */
    to: string;
    /**
     * 
     */
    minutes: number;
}
