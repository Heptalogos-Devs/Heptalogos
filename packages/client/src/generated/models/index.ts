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
    id: string;
    /**
     * 
     */
    kind: ActorKindEnum;
    /**
     * 
     */
    authorityRef: string;
}


/**
 * @export
 */
export const ActorKindEnum = {
    Human: 'human',
    Service: 'service',
    Subject: 'subject',
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
    id: string;
    /**
     * 
     */
    kind: ActorInputKindEnum;
    /**
     * 
     */
    authorityRef: string;
}


/**
 * @export
 */
export const ActorInputKindEnum = {
    Human: 'human',
    Service: 'service',
    Subject: 'subject',
    Worker: 'worker',
    Author: 'author',
} as const;
export type ActorInputKindEnum = typeof ActorInputKindEnum[keyof typeof ActorInputKindEnum];

/**
 * 
 * @export
 * @interface AppliedField
 */
export interface AppliedField {
    /**
     * 
     */
    definitionRevision: string;
    /**
     * 
     */
    revisions: Array<RevisionRef>;
    /**
     * 
     */
    value?: JsonValue | null;
}
/**
 * 
 * @export
 * @interface AppliedFieldInput
 */
export interface AppliedFieldInput {
    /**
     * 
     */
    definitionRevision: string;
    /**
     * 
     */
    revisions: Array<RevisionRefInput>;
    /**
     * 
     */
    value?: JsonValueInput | null;
}
/**
 * 
 * @export
 * @interface AuthenticatedIdentity
 */
export interface AuthenticatedIdentity {
    /**
     * 
     */
    actor: Actor;
    /**
     * 
     */
    consumer: Consumer;
}
/**
 * 
 * @export
 * @interface AuthenticatedIdentityInput
 */
export interface AuthenticatedIdentityInput {
    /**
     * 
     */
    actor: ActorInput;
    /**
     * 
     */
    consumer: ConsumerInput;
}
/**
 * 
 * @export
 * @interface BlobResult
 */
export interface BlobResult {
    /**
     * 
     */
    digest: string;
    /**
     * 
     */
    bytes: number;
    /**
     * 
     */
    mediaType: string;
    /**
     * 
     */
    ref: Ref;
}
/**
 * 
 * @export
 * @interface BlobResultInput
 */
export interface BlobResultInput {
    /**
     * 
     */
    digest: string;
    /**
     * 
     */
    bytes: number;
    /**
     * 
     */
    mediaType: string;
    /**
     * 
     */
    ref: RefInput;
}
/**
 * 
 * @export
 * @interface BudgetAllocationSnapshot
 */
export interface BudgetAllocationSnapshot {
    /**
     * 
     */
    allocationRef: Ref;
    /**
     * 
     */
    childOperationId: string;
    /**
     * 
     */
    receiptDigest: string;
    /**
     * 
     */
    taskRef: Ref;
    /**
     * 
     */
    budgetOwnerRef: Ref;
    /**
     * 
     */
    issuer: BudgetAllocationSnapshotInputIssuer;
    /**
     * 
     */
    target: BudgetAllocationSnapshotTarget;
    /**
     * 
     */
    limits: BudgetAllocationSnapshotLimits;
    /**
     * 
     */
    expiresAt: CapturedTimeOneOfPoint;
}
/**
 * 
 * @export
 * @interface BudgetAllocationSnapshotInput
 */
export interface BudgetAllocationSnapshotInput {
    /**
     * 
     */
    allocationRef: RefInput;
    /**
     * 
     */
    childOperationId: string;
    /**
     * 
     */
    receiptDigest: string;
    /**
     * 
     */
    taskRef: RefInput;
    /**
     * 
     */
    budgetOwnerRef: RefInput;
    /**
     * 
     */
    issuer: BudgetAllocationSnapshotInputIssuer;
    /**
     * 
     */
    target: BudgetAllocationSnapshotInputTarget;
    /**
     * 
     */
    limits: BudgetAllocationSnapshotInputLimits;
    /**
     * 
     */
    expiresAt: BudgetAllocationSnapshotInputExpiresAt;
}
/**
 * 
 * @export
 * @interface BudgetAllocationSnapshotInputExpiresAt
 */
export interface BudgetAllocationSnapshotInputExpiresAt {
    /**
     * 
     */
    domainId: BudgetAllocationSnapshotInputExpiresAtDomainIdEnum;
    /**
     * 
     */
    at: string;
}


/**
 * @export
 */
export const BudgetAllocationSnapshotInputExpiresAtDomainIdEnum = {
    Real: 'real',
} as const;
export type BudgetAllocationSnapshotInputExpiresAtDomainIdEnum = typeof BudgetAllocationSnapshotInputExpiresAtDomainIdEnum[keyof typeof BudgetAllocationSnapshotInputExpiresAtDomainIdEnum];

/**
 * 
 * @export
 * @interface BudgetAllocationSnapshotInputIssuer
 */
export interface BudgetAllocationSnapshotInputIssuer {
    /**
     * 
     */
    product: BudgetAllocationSnapshotInputIssuerProductEnum;
    /**
     * 
     */
    installationId: string;
    /**
     * 
     */
    authorityRef: string;
}


/**
 * @export
 */
export const BudgetAllocationSnapshotInputIssuerProductEnum = {
    Hept: 'hept',
} as const;
export type BudgetAllocationSnapshotInputIssuerProductEnum = typeof BudgetAllocationSnapshotInputIssuerProductEnum[keyof typeof BudgetAllocationSnapshotInputIssuerProductEnum];

/**
 * 
 * @export
 * @interface BudgetAllocationSnapshotInputLimits
 */
export interface BudgetAllocationSnapshotInputLimits {
    /**
     * 
     */
    totalAmount: MoneyInput;
    /**
     * 
     */
    perCallAmount?: MoneyInput;
    /**
     * 
     */
    maxCalls?: number;
    /**
     * 
     */
    maxTokens?: number;
}
/**
 * 
 * @export
 * @interface BudgetAllocationSnapshotInputTarget
 */
export interface BudgetAllocationSnapshotInputTarget {
    /**
     * 
     */
    product: BudgetAllocationSnapshotInputTargetProductEnum;
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
    consumer: ConsumerInput;
}


/**
 * @export
 */
export const BudgetAllocationSnapshotInputTargetProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type BudgetAllocationSnapshotInputTargetProductEnum = typeof BudgetAllocationSnapshotInputTargetProductEnum[keyof typeof BudgetAllocationSnapshotInputTargetProductEnum];

/**
 * 
 * @export
 * @interface BudgetAllocationSnapshotLimits
 */
export interface BudgetAllocationSnapshotLimits {
    /**
     * 
     */
    totalAmount: Money;
    /**
     * 
     */
    perCallAmount?: Money;
    /**
     * 
     */
    maxCalls?: number;
    /**
     * 
     */
    maxTokens?: number;
}
/**
 * 
 * @export
 * @interface BudgetAllocationSnapshotTarget
 */
export interface BudgetAllocationSnapshotTarget {
    /**
     * 
     */
    product: BudgetAllocationSnapshotTargetProductEnum;
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
    consumer: Consumer;
}


/**
 * @export
 */
export const BudgetAllocationSnapshotTargetProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type BudgetAllocationSnapshotTargetProductEnum = typeof BudgetAllocationSnapshotTargetProductEnum[keyof typeof BudgetAllocationSnapshotTargetProductEnum];

/**
 * 
 * @export
 * @interface BudgetAllocationUse
 */
export interface BudgetAllocationUse {
    /**
     * 
     */
    allocationRef: Ref;
    /**
     * 
     */
    childOperationId: string;
}
/**
 * 
 * @export
 * @interface BudgetAllocationUseInput
 */
export interface BudgetAllocationUseInput {
    /**
     * 
     */
    allocationRef: RefInput;
    /**
     * 
     */
    childOperationId: string;
}
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
    recurrenceId?: string;
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
    consumer: Consumer;
    /**
     * 
     */
    subjectId?: string;
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
    trace: TraceContext;
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
    consumer: ConsumerInput;
    /**
     * 
     */
    subjectId?: string;
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
    trace: TraceContextInput;
}
/**
 * @type CapturedTime
 * 
 * @export
 */
export type CapturedTime = CapturedTimeOneOf | CapturedTimeOneOf1;
/**
 * @type CapturedTimeInput
 * 
 * @export
 */
export type CapturedTimeInput = CapturedTimeInputOneOf | CapturedTimeInputOneOf1;
/**
 * 
 * @export
 * @interface CapturedTimeInputOneOf
 */
export interface CapturedTimeInputOneOf {
    /**
     * 
     */
    point: CapturedTimeInputOneOfPoint;
    /**
     * 
     */
    realAt: string;
}
/**
 * 
 * @export
 * @interface CapturedTimeInputOneOf1
 */
export interface CapturedTimeInputOneOf1 {
    /**
     * 
     */
    point: TimePointInput;
    /**
     * 
     */
    realAt: string;
    /**
     * 
     */
    clockRef: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    clockRevision: number;
    /**
     * 
     */
    segmentRef: ClockSegmentRefInput;
}
/**
 * 
 * @export
 * @interface CapturedTimeInputOneOf1ClockRef
 */
export interface CapturedTimeInputOneOf1ClockRef {
    /**
     * 
     */
    product: CapturedTimeInputOneOf1ClockRefProductEnum;
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
    kind: CapturedTimeInputOneOf1ClockRefKindEnum;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    revision: number;
}


/**
 * @export
 */
export const CapturedTimeInputOneOf1ClockRefProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type CapturedTimeInputOneOf1ClockRefProductEnum = typeof CapturedTimeInputOneOf1ClockRefProductEnum[keyof typeof CapturedTimeInputOneOf1ClockRefProductEnum];

/**
 * @export
 */
export const CapturedTimeInputOneOf1ClockRefKindEnum = {
    Clock: 'Clock',
} as const;
export type CapturedTimeInputOneOf1ClockRefKindEnum = typeof CapturedTimeInputOneOf1ClockRefKindEnum[keyof typeof CapturedTimeInputOneOf1ClockRefKindEnum];

/**
 * 
 * @export
 * @interface CapturedTimeInputOneOfPoint
 */
export interface CapturedTimeInputOneOfPoint {
    /**
     * 
     */
    domainId: CapturedTimeInputOneOfPointDomainIdEnum;
    /**
     * 
     */
    at: string;
}


/**
 * @export
 */
export const CapturedTimeInputOneOfPointDomainIdEnum = {
    Real: 'real',
} as const;
export type CapturedTimeInputOneOfPointDomainIdEnum = typeof CapturedTimeInputOneOfPointDomainIdEnum[keyof typeof CapturedTimeInputOneOfPointDomainIdEnum];

/**
 * 
 * @export
 * @interface CapturedTimeOneOf
 */
export interface CapturedTimeOneOf {
    /**
     * 
     */
    point: CapturedTimeOneOfPoint;
    /**
     * 
     */
    realAt: string;
}
/**
 * 
 * @export
 * @interface CapturedTimeOneOf1
 */
export interface CapturedTimeOneOf1 {
    /**
     * 
     */
    point: TimePoint;
    /**
     * 
     */
    realAt: string;
    /**
     * 
     */
    clockRef: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    clockRevision: number;
    /**
     * 
     */
    segmentRef: ClockSegmentRef;
}
/**
 * 
 * @export
 * @interface CapturedTimeOneOfPoint
 */
export interface CapturedTimeOneOfPoint {
    /**
     * 
     */
    domainId: CapturedTimeOneOfPointDomainIdEnum;
    /**
     * 
     */
    at: string;
}


/**
 * @export
 */
export const CapturedTimeOneOfPointDomainIdEnum = {
    Real: 'real',
} as const;
export type CapturedTimeOneOfPointDomainIdEnum = typeof CapturedTimeOneOfPointDomainIdEnum[keyof typeof CapturedTimeOneOfPointDomainIdEnum];

/**
 * 
 * @export
 * @interface ChangeSet
 */
export interface ChangeSet {
    /**
     * 
     */
    groups: Array<ChangeSetGroupsInner>;
}
/**
 * 
 * @export
 * @interface ChangeSetGroupsInner
 */
export interface ChangeSetGroupsInner {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    reason: string;
    /**
     * 
     */
    changes: Array<KnowledgeChange>;
}
/**
 * 
 * @export
 * @interface ChangeSetInput
 */
export interface ChangeSetInput {
    /**
     * 
     */
    groups: Array<ChangeSetInputGroupsInner>;
}
/**
 * 
 * @export
 * @interface ChangeSetInputGroupsInner
 */
export interface ChangeSetInputGroupsInner {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    reason: string;
    /**
     * 
     */
    changes: Array<KnowledgeChangeInput>;
}
/**
 * 
 * @export
 * @interface ChannelConfiguration
 */
export interface ChannelConfiguration {
    /**
     * 
     */
    host: ChannelConfigurationHostEnum;
    /**
     * 
     */
    adapterId: string;
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
    conversationKeys: Array<string>;
    /**
     * 
     */
    receive: boolean;
    /**
     * 
     */
    participate: boolean;
    /**
     * 
     */
    send: boolean;
    /**
     * 
     */
    network: ChannelConfigurationNetwork;
    /**
     * 
     */
    id?: string;
    /**
     * 
     */
    expectedRevision: number;
}


/**
 * @export
 */
export const ChannelConfigurationHostEnum = {
    Local: 'local',
    Astrbot: 'astrbot',
} as const;
export type ChannelConfigurationHostEnum = typeof ChannelConfigurationHostEnum[keyof typeof ChannelConfigurationHostEnum];

/**
 * 
 * @export
 * @interface ChannelConfigurationInput
 */
export interface ChannelConfigurationInput {
    /**
     * 
     */
    host: ChannelConfigurationInputHostEnum;
    /**
     * 
     */
    adapterId: string;
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
    /**
     * 
     */
    network?: ChannelConfigurationInputNetwork;
    /**
     * 
     */
    id?: string;
    /**
     * 
     */
    expectedRevision: number;
}


/**
 * @export
 */
export const ChannelConfigurationInputHostEnum = {
    Local: 'local',
    Astrbot: 'astrbot',
} as const;
export type ChannelConfigurationInputHostEnum = typeof ChannelConfigurationInputHostEnum[keyof typeof ChannelConfigurationInputHostEnum];

/**
 * 
 * @export
 * @interface ChannelConfigurationInputNetwork
 */
export interface ChannelConfigurationInputNetwork {
    /**
     * 
     */
    profileId?: string;
    /**
     * 
     */
    addressScope?: ChannelConfigurationInputNetworkAddressScopeEnum;
    /**
     * 
     */
    allowedPrivateRanges?: Array<string>;
}


/**
 * @export
 */
export const ChannelConfigurationInputNetworkAddressScopeEnum = {
    Public: 'public',
    ConfiguredPrivate: 'configured_private',
} as const;
export type ChannelConfigurationInputNetworkAddressScopeEnum = typeof ChannelConfigurationInputNetworkAddressScopeEnum[keyof typeof ChannelConfigurationInputNetworkAddressScopeEnum];

/**
 * 
 * @export
 * @interface ChannelConfigurationNetwork
 */
export interface ChannelConfigurationNetwork {
    /**
     * 
     */
    profileId: string;
    /**
     * 
     */
    addressScope: ChannelConfigurationNetworkAddressScopeEnum;
    /**
     * 
     */
    allowedPrivateRanges: Array<string>;
}


/**
 * @export
 */
export const ChannelConfigurationNetworkAddressScopeEnum = {
    Public: 'public',
    ConfiguredPrivate: 'configured_private',
} as const;
export type ChannelConfigurationNetworkAddressScopeEnum = typeof ChannelConfigurationNetworkAddressScopeEnum[keyof typeof ChannelConfigurationNetworkAddressScopeEnum];

/**
 * 
 * @export
 * @interface ClockAdvanceRequest
 */
export interface ClockAdvanceRequest {
    /**
     * 
     */
    clockRef: ClockRef;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    deltaMicros: string;
}
/**
 * 
 * @export
 * @interface ClockAdvanceRequestInput
 */
export interface ClockAdvanceRequestInput {
    /**
     * 
     */
    clockRef: ClockRefInput;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    deltaMicros: string;
}
/**
 * 
 * @export
 * @interface ClockChangeReceipt
 */
export interface ClockChangeReceipt {
    /**
     * 
     */
    operationId: string;
    /**
     * 
     */
    record: ClockRecord;
    /**
     * 
     */
    snapshot: ClockSnapshot;
    /**
     * 
     */
    closure?: ClockSegmentClosure;
    /**
     * 
     */
    lifecycle?: ClockChangeReceiptInputLifecycle;
}
/**
 * 
 * @export
 * @interface ClockChangeReceiptInput
 */
export interface ClockChangeReceiptInput {
    /**
     * 
     */
    operationId: string;
    /**
     * 
     */
    record: ClockRecordInput;
    /**
     * 
     */
    snapshot: ClockSnapshotInput;
    /**
     * 
     */
    closure?: ClockSegmentClosureInput;
    /**
     * 
     */
    lifecycle?: ClockChangeReceiptInputLifecycle;
}
/**
 * 
 * @export
 * @interface ClockChangeReceiptInputLifecycle
 */
export interface ClockChangeReceiptInputLifecycle {
    /**
     * 
     */
    status: ClockChangeReceiptInputLifecycleStatusEnum;
    /**
     * 
     */
    resumeOperationId?: string;
    /**
     * 
     */
    gap: string | null;
}


/**
 * @export
 */
export const ClockChangeReceiptInputLifecycleStatusEnum = {
    Offline: 'offline',
    Resumed: 'resumed',
    Superseded: 'superseded',
    Recovered: 'recovered',
} as const;
export type ClockChangeReceiptInputLifecycleStatusEnum = typeof ClockChangeReceiptInputLifecycleStatusEnum[keyof typeof ClockChangeReceiptInputLifecycleStatusEnum];

/**
 * 
 * @export
 * @interface ClockConfigureRequest
 */
export interface ClockConfigureRequest {
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    initialAt: any;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    offlinePolicy: ClockOfflinePolicy;
    /**
     * 
     */
    clockRef?: ClockRef;
}
/**
 * 
 * @export
 * @interface ClockConfigureRequestAnyOf
 */
export interface ClockConfigureRequestAnyOf {
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    expectedRevision: ClockConfigureRequestAnyOfExpectedRevisionEnum;
    /**
     * 
     */
    initialAt: any;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    offlinePolicy: ClockOfflinePolicy;
}


/**
 * @export
 */
export const ClockConfigureRequestAnyOfExpectedRevisionEnum = {
    NUMBER_0: 0,
} as const;
export type ClockConfigureRequestAnyOfExpectedRevisionEnum = typeof ClockConfigureRequestAnyOfExpectedRevisionEnum[keyof typeof ClockConfigureRequestAnyOfExpectedRevisionEnum];

/**
 * 
 * @export
 * @interface ClockConfigureRequestAnyOf1
 */
export interface ClockConfigureRequestAnyOf1 {
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    clockRef?: ClockRef;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    rate?: string;
    /**
     * 
     */
    offlinePolicy?: ClockOfflinePolicy;
}
/**
 * 
 * @export
 * @interface ClockConfigureRequestInput
 */
export interface ClockConfigureRequestInput {
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    initialAt: string;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    offlinePolicy: ClockOfflinePolicyInput;
    /**
     * 
     */
    clockRef?: ClockRefInput;
}
/**
 * 
 * @export
 * @interface ClockConfigureRequestInputAnyOf
 */
export interface ClockConfigureRequestInputAnyOf {
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    expectedRevision: ClockConfigureRequestInputAnyOfExpectedRevisionEnum;
    /**
     * 
     */
    initialAt: string;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    offlinePolicy: ClockOfflinePolicyInput;
}


/**
 * @export
 */
export const ClockConfigureRequestInputAnyOfExpectedRevisionEnum = {
    NUMBER_0: 0,
} as const;
export type ClockConfigureRequestInputAnyOfExpectedRevisionEnum = typeof ClockConfigureRequestInputAnyOfExpectedRevisionEnum[keyof typeof ClockConfigureRequestInputAnyOfExpectedRevisionEnum];

/**
 * 
 * @export
 * @interface ClockConfigureRequestInputAnyOf1
 */
export interface ClockConfigureRequestInputAnyOf1 {
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    clockRef?: ClockRefInput;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    rate?: string;
    /**
     * 
     */
    offlinePolicy?: ClockOfflinePolicyInput;
}
/**
 * @type ClockDeadline
 * 
 * @export
 */
export type ClockDeadline = ClockDeadlineInputOneOf1 | ClockDeadlineInputOneOf2 | ClockDeadlineOneOf;
/**
 * @type ClockDeadlineInput
 * 
 * @export
 */
export type ClockDeadlineInput = ClockDeadlineInputOneOf | ClockDeadlineInputOneOf1 | ClockDeadlineInputOneOf2;
/**
 * 
 * @export
 * @interface ClockDeadlineInputOneOf
 */
export interface ClockDeadlineInputOneOf {
    /**
     * 
     */
    kind: ClockDeadlineInputOneOfKindEnum;
    /**
     * 
     */
    at: string;
}


/**
 * @export
 */
export const ClockDeadlineInputOneOfKindEnum = {
    Due: 'due',
} as const;
export type ClockDeadlineInputOneOfKindEnum = typeof ClockDeadlineInputOneOfKindEnum[keyof typeof ClockDeadlineInputOneOfKindEnum];

/**
 * 
 * @export
 * @interface ClockDeadlineInputOneOf1
 */
export interface ClockDeadlineInputOneOf1 {
    /**
     * 
     */
    kind: ClockDeadlineInputOneOf1KindEnum;
}


/**
 * @export
 */
export const ClockDeadlineInputOneOf1KindEnum = {
    Paused: 'paused',
} as const;
export type ClockDeadlineInputOneOf1KindEnum = typeof ClockDeadlineInputOneOf1KindEnum[keyof typeof ClockDeadlineInputOneOf1KindEnum];

/**
 * 
 * @export
 * @interface ClockDeadlineInputOneOf2
 */
export interface ClockDeadlineInputOneOf2 {
    /**
     * 
     */
    kind: ClockDeadlineInputOneOf2KindEnum;
}


/**
 * @export
 */
export const ClockDeadlineInputOneOf2KindEnum = {
    Unmapped: 'unmapped',
} as const;
export type ClockDeadlineInputOneOf2KindEnum = typeof ClockDeadlineInputOneOf2KindEnum[keyof typeof ClockDeadlineInputOneOf2KindEnum];

/**
 * 
 * @export
 * @interface ClockDeadlineOneOf
 */
export interface ClockDeadlineOneOf {
    /**
     * 
     */
    kind: ClockDeadlineOneOfKindEnum;
    /**
     * 
     */
    at: string;
}


/**
 * @export
 */
export const ClockDeadlineOneOfKindEnum = {
    Due: 'due',
} as const;
export type ClockDeadlineOneOfKindEnum = typeof ClockDeadlineOneOfKindEnum[keyof typeof ClockDeadlineOneOfKindEnum];

/**
 * @type ClockOfflinePolicy
 * 
 * @export
 */
export type ClockOfflinePolicy = ClockOfflinePolicyInputOneOf | ClockOfflinePolicyOneOf;
/**
 * @type ClockOfflinePolicyInput
 * 
 * @export
 */
export type ClockOfflinePolicyInput = ClockOfflinePolicyInputOneOf | ClockOfflinePolicyInputOneOf1;
/**
 * 
 * @export
 * @interface ClockOfflinePolicyInputOneOf
 */
export interface ClockOfflinePolicyInputOneOf {
    /**
     * 
     */
    mode: ClockOfflinePolicyInputOneOfModeEnum;
}


/**
 * @export
 */
export const ClockOfflinePolicyInputOneOfModeEnum = {
    Freeze: 'freeze',
} as const;
export type ClockOfflinePolicyInputOneOfModeEnum = typeof ClockOfflinePolicyInputOneOfModeEnum[keyof typeof ClockOfflinePolicyInputOneOfModeEnum];

/**
 * 
 * @export
 * @interface ClockOfflinePolicyInputOneOf1
 */
export interface ClockOfflinePolicyInputOneOf1 {
    /**
     * 
     */
    mode: ClockOfflinePolicyInputOneOf1ModeEnum;
    /**
     * 
     */
    offlineRate: string;
}


/**
 * @export
 */
export const ClockOfflinePolicyInputOneOf1ModeEnum = {
    Elapsed: 'elapsed',
} as const;
export type ClockOfflinePolicyInputOneOf1ModeEnum = typeof ClockOfflinePolicyInputOneOf1ModeEnum[keyof typeof ClockOfflinePolicyInputOneOf1ModeEnum];

/**
 * 
 * @export
 * @interface ClockOfflinePolicyOneOf
 */
export interface ClockOfflinePolicyOneOf {
    /**
     * 
     */
    mode: ClockOfflinePolicyOneOfModeEnum;
    /**
     * 
     */
    offlineRate: string;
}


/**
 * @export
 */
export const ClockOfflinePolicyOneOfModeEnum = {
    Elapsed: 'elapsed',
} as const;
export type ClockOfflinePolicyOneOfModeEnum = typeof ClockOfflinePolicyOneOfModeEnum[keyof typeof ClockOfflinePolicyOneOfModeEnum];

/**
 * 
 * @export
 * @interface ClockPauseRequest
 */
export interface ClockPauseRequest {
    /**
     * 
     */
    clockRef: ClockRef;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface ClockPauseRequestInput
 */
export interface ClockPauseRequestInput {
    /**
     * 
     */
    clockRef: ClockRefInput;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface ClockRecord
 */
export interface ClockRecord {
    /**
     * 
     */
    ref: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    currentSegmentRef: ClockSegmentRef;
    /**
     * 
     */
    onlineRate: string;
    /**
     * 
     */
    offlinePolicy: ClockOfflinePolicy;
    /**
     * 
     */
    status: ClockRecordStatusEnum;
}


/**
 * @export
 */
export const ClockRecordStatusEnum = {
    Running: 'running',
    Paused: 'paused',
    Retired: 'retired',
} as const;
export type ClockRecordStatusEnum = typeof ClockRecordStatusEnum[keyof typeof ClockRecordStatusEnum];

/**
 * 
 * @export
 * @interface ClockRecordInput
 */
export interface ClockRecordInput {
    /**
     * 
     */
    ref: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    currentSegmentRef: ClockSegmentRefInput;
    /**
     * 
     */
    onlineRate: string;
    /**
     * 
     */
    offlinePolicy: ClockOfflinePolicyInput;
    /**
     * 
     */
    status: ClockRecordInputStatusEnum;
}


/**
 * @export
 */
export const ClockRecordInputStatusEnum = {
    Running: 'running',
    Paused: 'paused',
    Retired: 'retired',
} as const;
export type ClockRecordInputStatusEnum = typeof ClockRecordInputStatusEnum[keyof typeof ClockRecordInputStatusEnum];

/**
 * 
 * @export
 * @interface ClockRef
 */
export interface ClockRef {
    /**
     * 
     */
    product: ClockRefProductEnum;
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
    kind: ClockRefKindEnum;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    revision?: number;
}


/**
 * @export
 */
export const ClockRefProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type ClockRefProductEnum = typeof ClockRefProductEnum[keyof typeof ClockRefProductEnum];

/**
 * @export
 */
export const ClockRefKindEnum = {
    Clock: 'Clock',
} as const;
export type ClockRefKindEnum = typeof ClockRefKindEnum[keyof typeof ClockRefKindEnum];

/**
 * 
 * @export
 * @interface ClockRefInput
 */
export interface ClockRefInput {
    /**
     * 
     */
    product: ClockRefInputProductEnum;
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
    kind: ClockRefInputKindEnum;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    revision?: number;
}


/**
 * @export
 */
export const ClockRefInputProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type ClockRefInputProductEnum = typeof ClockRefInputProductEnum[keyof typeof ClockRefInputProductEnum];

/**
 * @export
 */
export const ClockRefInputKindEnum = {
    Clock: 'Clock',
} as const;
export type ClockRefInputKindEnum = typeof ClockRefInputKindEnum[keyof typeof ClockRefInputKindEnum];

/**
 * 
 * @export
 * @interface ClockReferencesReadRequest
 */
export interface ClockReferencesReadRequest {
    /**
     * 
     */
    refs: Array<RefInput>;
    /**
     * 
     */
    subjectId?: string;
}
/**
 * 
 * @export
 * @interface ClockResumeRequest
 */
export interface ClockResumeRequest {
    /**
     * 
     */
    clockRef: ClockRef;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    rate: string;
}
/**
 * 
 * @export
 * @interface ClockResumeRequestInput
 */
export interface ClockResumeRequestInput {
    /**
     * 
     */
    clockRef: ClockRefInput;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    rate: string;
}
/**
 * 
 * @export
 * @interface ClockSegment
 */
export interface ClockSegment {
    /**
     * 
     */
    ref: ClockSegmentRef;
    /**
     * 
     */
    clockRef: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    domainAnchor: string;
    /**
     * 
     */
    realAnchor: string;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    startedByOperationId: string;
    /**
     * 
     */
    reason: ClockSegmentReasonEnum;
}


/**
 * @export
 */
export const ClockSegmentReasonEnum = {
    Configure: 'configure',
    ChangeRate: 'change_rate',
    Pause: 'pause',
    Resume: 'resume',
    Advance: 'advance',
    HostStart: 'host_start',
    HostStop: 'host_stop',
} as const;
export type ClockSegmentReasonEnum = typeof ClockSegmentReasonEnum[keyof typeof ClockSegmentReasonEnum];

/**
 * 
 * @export
 * @interface ClockSegmentClosure
 */
export interface ClockSegmentClosure {
    /**
     * 
     */
    segmentRef: ClockSegmentRef;
    /**
     * 
     */
    closedByClockRevision: number;
    /**
     * 
     */
    domainEnd: string;
    /**
     * 
     */
    endedRealAt: string;
    /**
     * 
     */
    endedByOperationId: string;
}
/**
 * 
 * @export
 * @interface ClockSegmentClosureInput
 */
export interface ClockSegmentClosureInput {
    /**
     * 
     */
    segmentRef: ClockSegmentRefInput;
    /**
     * 
     */
    closedByClockRevision: number;
    /**
     * 
     */
    domainEnd: string;
    /**
     * 
     */
    endedRealAt: string;
    /**
     * 
     */
    endedByOperationId: string;
}
/**
 * 
 * @export
 * @interface ClockSegmentInput
 */
export interface ClockSegmentInput {
    /**
     * 
     */
    ref: ClockSegmentRefInput;
    /**
     * 
     */
    clockRef: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    domainAnchor: string;
    /**
     * 
     */
    realAnchor: string;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    startedByOperationId: string;
    /**
     * 
     */
    reason: ClockSegmentInputReasonEnum;
}


/**
 * @export
 */
export const ClockSegmentInputReasonEnum = {
    Configure: 'configure',
    ChangeRate: 'change_rate',
    Pause: 'pause',
    Resume: 'resume',
    Advance: 'advance',
    HostStart: 'host_start',
    HostStop: 'host_stop',
} as const;
export type ClockSegmentInputReasonEnum = typeof ClockSegmentInputReasonEnum[keyof typeof ClockSegmentInputReasonEnum];

/**
 * 
 * @export
 * @interface ClockSegmentRef
 */
export interface ClockSegmentRef {
    /**
     * 
     */
    product: ClockSegmentRefProductEnum;
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
    kind: ClockSegmentRefKindEnum;
    /**
     * 
     */
    id: string;
}


/**
 * @export
 */
export const ClockSegmentRefProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type ClockSegmentRefProductEnum = typeof ClockSegmentRefProductEnum[keyof typeof ClockSegmentRefProductEnum];

/**
 * @export
 */
export const ClockSegmentRefKindEnum = {
    ClockSegment: 'ClockSegment',
} as const;
export type ClockSegmentRefKindEnum = typeof ClockSegmentRefKindEnum[keyof typeof ClockSegmentRefKindEnum];

/**
 * 
 * @export
 * @interface ClockSegmentRefInput
 */
export interface ClockSegmentRefInput {
    /**
     * 
     */
    product: ClockSegmentRefInputProductEnum;
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
    kind: ClockSegmentRefInputKindEnum;
    /**
     * 
     */
    id: string;
}


/**
 * @export
 */
export const ClockSegmentRefInputProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type ClockSegmentRefInputProductEnum = typeof ClockSegmentRefInputProductEnum[keyof typeof ClockSegmentRefInputProductEnum];

/**
 * @export
 */
export const ClockSegmentRefInputKindEnum = {
    ClockSegment: 'ClockSegment',
} as const;
export type ClockSegmentRefInputKindEnum = typeof ClockSegmentRefInputKindEnum[keyof typeof ClockSegmentRefInputKindEnum];

/**
 * 
 * @export
 * @interface ClockSnapshot
 */
export interface ClockSnapshot {
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    now: CapturedTimeOneOf1;
    /**
     * 
     */
    clockRef: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    segment: ClockSegment;
}
/**
 * 
 * @export
 * @interface ClockSnapshotAnyOf
 */
export interface ClockSnapshotAnyOf {
    /**
     * 
     */
    domainId: ClockSnapshotAnyOfDomainIdEnum;
    /**
     * 
     */
    rate: ClockSnapshotAnyOfRateEnum;
    /**
     * 
     */
    now: CapturedTimeOneOf;
}


/**
 * @export
 */
export const ClockSnapshotAnyOfDomainIdEnum = {
    Real: 'real',
} as const;
export type ClockSnapshotAnyOfDomainIdEnum = typeof ClockSnapshotAnyOfDomainIdEnum[keyof typeof ClockSnapshotAnyOfDomainIdEnum];

/**
 * @export
 */
export const ClockSnapshotAnyOfRateEnum = {
    _1: '1',
} as const;
export type ClockSnapshotAnyOfRateEnum = typeof ClockSnapshotAnyOfRateEnum[keyof typeof ClockSnapshotAnyOfRateEnum];

/**
 * 
 * @export
 * @interface ClockSnapshotAnyOf1
 */
export interface ClockSnapshotAnyOf1 {
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    clockRef: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    segment: ClockSegment;
    /**
     * 
     */
    now: CapturedTimeOneOf1;
}
/**
 * 
 * @export
 * @interface ClockSnapshotInput
 */
export interface ClockSnapshotInput {
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    now: CapturedTimeInputOneOf1;
    /**
     * 
     */
    clockRef: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    segment: ClockSegmentInput;
}
/**
 * 
 * @export
 * @interface ClockSnapshotInputAnyOf
 */
export interface ClockSnapshotInputAnyOf {
    /**
     * 
     */
    domainId: ClockSnapshotInputAnyOfDomainIdEnum;
    /**
     * 
     */
    rate: ClockSnapshotInputAnyOfRateEnum;
    /**
     * 
     */
    now: CapturedTimeInputOneOf;
}


/**
 * @export
 */
export const ClockSnapshotInputAnyOfDomainIdEnum = {
    Real: 'real',
} as const;
export type ClockSnapshotInputAnyOfDomainIdEnum = typeof ClockSnapshotInputAnyOfDomainIdEnum[keyof typeof ClockSnapshotInputAnyOfDomainIdEnum];

/**
 * @export
 */
export const ClockSnapshotInputAnyOfRateEnum = {
    _1: '1',
} as const;
export type ClockSnapshotInputAnyOfRateEnum = typeof ClockSnapshotInputAnyOfRateEnum[keyof typeof ClockSnapshotInputAnyOfRateEnum];

/**
 * 
 * @export
 * @interface ClockSnapshotInputAnyOf1
 */
export interface ClockSnapshotInputAnyOf1 {
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    clockRef: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    segment: ClockSegmentInput;
    /**
     * 
     */
    now: CapturedTimeInputOneOf1;
}
/**
 * 
 * @export
 * @interface CognitiveSchema
 */
export interface CognitiveSchema {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: CognitiveSchemaKindEnum;
    /**
     * 
     */
    context: string;
    /**
     * 
     */
    supports: Array<Ref>;
    /**
     * 
     */
    exceptions: Array<Ref>;
    /**
     * 
     */
    openQuestions: Array<string>;
    /**
     * 
     */
    prediction?: string;
}


/**
 * @export
 */
export const CognitiveSchemaKindEnum = {
    Schema: 'Schema',
} as const;
export type CognitiveSchemaKindEnum = typeof CognitiveSchemaKindEnum[keyof typeof CognitiveSchemaKindEnum];

/**
 * 
 * @export
 * @interface CognitiveSchemaInput
 */
export interface CognitiveSchemaInput {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: CognitiveSchemaInputKindEnum;
    /**
     * 
     */
    context: string;
    /**
     * 
     */
    supports: Array<RefInput>;
    /**
     * 
     */
    exceptions: Array<RefInput>;
    /**
     * 
     */
    openQuestions?: Array<string>;
    /**
     * 
     */
    prediction?: string;
}


/**
 * @export
 */
export const CognitiveSchemaInputKindEnum = {
    Schema: 'Schema',
} as const;
export type CognitiveSchemaInputKindEnum = typeof CognitiveSchemaInputKindEnum[keyof typeof CognitiveSchemaInputKindEnum];

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
 * @interface Concept
 */
export interface Concept {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: ConceptKindEnum;
    /**
     * 
     */
    name: string;
    /**
     * 
     */
    aliases: Array<string>;
    /**
     * 
     */
    language: string;
}


/**
 * @export
 */
export const ConceptKindEnum = {
    Concept: 'Concept',
} as const;
export type ConceptKindEnum = typeof ConceptKindEnum[keyof typeof ConceptKindEnum];

/**
 * 
 * @export
 * @interface ConceptInput
 */
export interface ConceptInput {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: ConceptInputKindEnum;
    /**
     * 
     */
    name: string;
    /**
     * 
     */
    aliases?: Array<string>;
    /**
     * 
     */
    language?: string;
}


/**
 * @export
 */
export const ConceptInputKindEnum = {
    Concept: 'Concept',
} as const;
export type ConceptInputKindEnum = typeof ConceptInputKindEnum[keyof typeof ConceptInputKindEnum];

/**
 * @type ConfigScope
 * 
 * @export
 */
export type ConfigScope = ConfigScopeInputOneOf | ConfigScopeOneOf | ConfigScopeOneOf1;
/**
 * @type ConfigScopeInput
 * 
 * @export
 */
export type ConfigScopeInput = ConfigScopeInputOneOf | ConfigScopeInputOneOf1 | ConfigScopeInputOneOf2;
/**
 * 
 * @export
 * @interface ConfigScopeInputOneOf
 */
export interface ConfigScopeInputOneOf {
    /**
     * 
     */
    kind: ConfigScopeInputOneOfKindEnum;
    /**
     * 
     */
    installationId: string;
}


/**
 * @export
 */
export const ConfigScopeInputOneOfKindEnum = {
    Installation: 'installation',
} as const;
export type ConfigScopeInputOneOfKindEnum = typeof ConfigScopeInputOneOfKindEnum[keyof typeof ConfigScopeInputOneOfKindEnum];

/**
 * 
 * @export
 * @interface ConfigScopeInputOneOf1
 */
export interface ConfigScopeInputOneOf1 {
    /**
     * 
     */
    kind: ConfigScopeInputOneOf1KindEnum;
    /**
     * 
     */
    subjectId: string;
}


/**
 * @export
 */
export const ConfigScopeInputOneOf1KindEnum = {
    Subject: 'subject',
} as const;
export type ConfigScopeInputOneOf1KindEnum = typeof ConfigScopeInputOneOf1KindEnum[keyof typeof ConfigScopeInputOneOf1KindEnum];

/**
 * 
 * @export
 * @interface ConfigScopeInputOneOf2
 */
export interface ConfigScopeInputOneOf2 {
    /**
     * 
     */
    kind: ConfigScopeInputOneOf2KindEnum;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    roleId: string;
}


/**
 * @export
 */
export const ConfigScopeInputOneOf2KindEnum = {
    Role: 'role',
} as const;
export type ConfigScopeInputOneOf2KindEnum = typeof ConfigScopeInputOneOf2KindEnum[keyof typeof ConfigScopeInputOneOf2KindEnum];

/**
 * 
 * @export
 * @interface ConfigScopeOneOf
 */
export interface ConfigScopeOneOf {
    /**
     * 
     */
    kind: ConfigScopeOneOfKindEnum;
    /**
     * 
     */
    subjectId: string;
}


/**
 * @export
 */
export const ConfigScopeOneOfKindEnum = {
    Subject: 'subject',
} as const;
export type ConfigScopeOneOfKindEnum = typeof ConfigScopeOneOfKindEnum[keyof typeof ConfigScopeOneOfKindEnum];

/**
 * 
 * @export
 * @interface ConfigScopeOneOf1
 */
export interface ConfigScopeOneOf1 {
    /**
     * 
     */
    kind: ConfigScopeOneOf1KindEnum;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    roleId: string;
}


/**
 * @export
 */
export const ConfigScopeOneOf1KindEnum = {
    Role: 'role',
} as const;
export type ConfigScopeOneOf1KindEnum = typeof ConfigScopeOneOf1KindEnum[keyof typeof ConfigScopeOneOf1KindEnum];

/**
 * 
 * @export
 * @interface ConfigSnapshot
 */
export interface ConfigSnapshot {
    /**
     * 
     */
    values: { [key: string]: JsonValue; };
    /**
     * 
     */
    sources: { [key: string]: ConfigSnapshotSourcesValue; };
    /**
     * 
     */
    revisions: Array<RevisionRef>;
    /**
     * 
     */
    definitionRevision: string;
}
/**
 * 
 * @export
 * @interface ConfigSnapshotInput
 */
export interface ConfigSnapshotInput {
    /**
     * 
     */
    values: { [key: string]: JsonValueInput; };
    /**
     * 
     */
    sources: { [key: string]: ConfigSnapshotInputSourcesValue; };
    /**
     * 
     */
    revisions: Array<RevisionRefInput>;
    /**
     * 
     */
    definitionRevision: string;
}
/**
 * 
 * @export
 * @interface ConfigSnapshotInputSourcesValue
 */
export interface ConfigSnapshotInputSourcesValue {
    /**
     * 
     */
    source: ConfigSnapshotInputSourcesValueSourceEnum;
    /**
     * 
     */
    revision?: RevisionRefInput;
}


/**
 * @export
 */
export const ConfigSnapshotInputSourcesValueSourceEnum = {
    Default: 'default',
    Override: 'override',
} as const;
export type ConfigSnapshotInputSourcesValueSourceEnum = typeof ConfigSnapshotInputSourcesValueSourceEnum[keyof typeof ConfigSnapshotInputSourcesValueSourceEnum];

/**
 * 
 * @export
 * @interface ConfigSnapshotSourcesValue
 */
export interface ConfigSnapshotSourcesValue {
    /**
     * 
     */
    source: ConfigSnapshotSourcesValueSourceEnum;
    /**
     * 
     */
    revision?: RevisionRef;
}


/**
 * @export
 */
export const ConfigSnapshotSourcesValueSourceEnum = {
    Default: 'default',
    Override: 'override',
} as const;
export type ConfigSnapshotSourcesValueSourceEnum = typeof ConfigSnapshotSourcesValueSourceEnum[keyof typeof ConfigSnapshotSourcesValueSourceEnum];

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
 * @interface ConsumerAppliedView
 */
export interface ConsumerAppliedView {
    /**
     * 
     */
    processBootId: string;
    /**
     * 
     */
    consumerId: string;
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    fields: { [key: string]: ConsumerAppliedViewFieldsValue; };
    /**
     * 
     */
    error?: Problem;
}
/**
 * 
 * @export
 * @interface ConsumerAppliedViewFieldsValue
 */
export interface ConsumerAppliedViewFieldsValue {
    /**
     * 
     */
    effect: ConsumerAppliedViewFieldsValueEffectEnum;
    /**
     * 
     */
    state: ConsumerAppliedViewFieldsValueStateEnum;
    /**
     * 
     */
    desired: AppliedField;
    /**
     * 
     */
    applied?: AppliedField;
}


/**
 * @export
 */
export const ConsumerAppliedViewFieldsValueEffectEnum = {
    Hot: 'hot',
    NextCall: 'next_call',
    Restart: 'restart',
} as const;
export type ConsumerAppliedViewFieldsValueEffectEnum = typeof ConsumerAppliedViewFieldsValueEffectEnum[keyof typeof ConsumerAppliedViewFieldsValueEffectEnum];

/**
 * @export
 */
export const ConsumerAppliedViewFieldsValueStateEnum = {
    Current: 'current',
    Pending: 'pending',
    Unknown: 'unknown',
    Failed: 'failed',
} as const;
export type ConsumerAppliedViewFieldsValueStateEnum = typeof ConsumerAppliedViewFieldsValueStateEnum[keyof typeof ConsumerAppliedViewFieldsValueStateEnum];

/**
 * 
 * @export
 * @interface ConsumerAppliedViewInput
 */
export interface ConsumerAppliedViewInput {
    /**
     * 
     */
    processBootId: string;
    /**
     * 
     */
    consumerId: string;
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    fields: { [key: string]: ConsumerAppliedViewInputFieldsValue; };
    /**
     * 
     */
    error?: ProblemInput;
}
/**
 * 
 * @export
 * @interface ConsumerAppliedViewInputFieldsValue
 */
export interface ConsumerAppliedViewInputFieldsValue {
    /**
     * 
     */
    effect: ConsumerAppliedViewInputFieldsValueEffectEnum;
    /**
     * 
     */
    state: ConsumerAppliedViewInputFieldsValueStateEnum;
    /**
     * 
     */
    desired: AppliedFieldInput;
    /**
     * 
     */
    applied?: AppliedFieldInput;
}


/**
 * @export
 */
export const ConsumerAppliedViewInputFieldsValueEffectEnum = {
    Hot: 'hot',
    NextCall: 'next_call',
    Restart: 'restart',
} as const;
export type ConsumerAppliedViewInputFieldsValueEffectEnum = typeof ConsumerAppliedViewInputFieldsValueEffectEnum[keyof typeof ConsumerAppliedViewInputFieldsValueEffectEnum];

/**
 * @export
 */
export const ConsumerAppliedViewInputFieldsValueStateEnum = {
    Current: 'current',
    Pending: 'pending',
    Unknown: 'unknown',
    Failed: 'failed',
} as const;
export type ConsumerAppliedViewInputFieldsValueStateEnum = typeof ConsumerAppliedViewInputFieldsValueStateEnum[keyof typeof ConsumerAppliedViewInputFieldsValueStateEnum];

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
 * @interface ContextBlock
 */
export interface ContextBlock {
    /**
     * 
     */
    kind: ContextBlockKindEnum;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    refs: Array<Ref>;
    /**
     * 
     */
    tokens: number;
}


/**
 * @export
 */
export const ContextBlockKindEnum = {
    Task: 'task',
    Identity: 'identity',
    Situation: 'situation',
    Knowledge: 'knowledge',
    Sources: 'sources',
    Work: 'work',
} as const;
export type ContextBlockKindEnum = typeof ContextBlockKindEnum[keyof typeof ContextBlockKindEnum];

/**
 * 
 * @export
 * @interface ContextBlockInput
 */
export interface ContextBlockInput {
    /**
     * 
     */
    kind: ContextBlockInputKindEnum;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    refs: Array<RefInput>;
    /**
     * 
     */
    tokens: number;
}


/**
 * @export
 */
export const ContextBlockInputKindEnum = {
    Task: 'task',
    Identity: 'identity',
    Situation: 'situation',
    Knowledge: 'knowledge',
    Sources: 'sources',
    Work: 'work',
} as const;
export type ContextBlockInputKindEnum = typeof ContextBlockInputKindEnum[keyof typeof ContextBlockInputKindEnum];

/**
 * 
 * @export
 * @interface ContextPrepare
 */
export interface ContextPrepare {
    /**
     * 
     */
    consumer: Consumer;
    /**
     * 
     */
    role: string;
    /**
     * 
     */
    workContextId?: string;
    /**
     * 
     */
    roleTask: string;
    /**
     * 
     */
    situation: string;
    /**
     * 
     */
    query?: string;
    /**
     * 
     */
    latestMaterials: Array<InputPortion>;
    /**
     * 
     */
    requiredSources: Array<Ref>;
    /**
     * 
     */
    model: ContextPrepareModel;
    /**
     * 
     */
    budget: ContextPrepareBudget;
    /**
     * 
     */
    observed: TimePointRequest;
}
/**
 * 
 * @export
 * @interface ContextPrepareBudget
 */
export interface ContextPrepareBudget {
    /**
     * 
     */
    outputTokens: number;
    /**
     * 
     */
    toolTokens: number;
    /**
     * 
     */
    requiredTokens: number;
    /**
     * 
     */
    mediaTokens: number;
    /**
     * 
     */
    cognitionTokens?: number;
}
/**
 * 
 * @export
 * @interface ContextPrepareInput
 */
export interface ContextPrepareInput {
    /**
     * 
     */
    consumer: ConsumerInput;
    /**
     * 
     */
    role?: string;
    /**
     * 
     */
    workContextId?: string;
    /**
     * 
     */
    roleTask?: string;
    /**
     * 
     */
    situation?: string;
    /**
     * 
     */
    query?: string;
    /**
     * 
     */
    latestMaterials?: Array<InputPortionInput>;
    /**
     * 
     */
    requiredSources?: Array<RefInput>;
    /**
     * 
     */
    model: ContextPrepareInputModel;
    /**
     * 
     */
    budget: ContextPrepareInputBudget;
    /**
     * 
     */
    observed: TimePointRequestInput;
}
/**
 * 
 * @export
 * @interface ContextPrepareInputBudget
 */
export interface ContextPrepareInputBudget {
    /**
     * 
     */
    outputTokens: number;
    /**
     * 
     */
    toolTokens?: number;
    /**
     * 
     */
    requiredTokens?: number;
    /**
     * 
     */
    mediaTokens?: number;
    /**
     * 
     */
    cognitionTokens?: number;
}
/**
 * 
 * @export
 * @interface ContextPrepareInputModel
 */
export interface ContextPrepareInputModel {
    /**
     * 
     */
    resourceId: string;
    /**
     * 
     */
    modelId: string;
    /**
     * 
     */
    contextLimit: number;
}
/**
 * 
 * @export
 * @interface ContextPrepareModel
 */
export interface ContextPrepareModel {
    /**
     * 
     */
    resourceId: string;
    /**
     * 
     */
    modelId: string;
    /**
     * 
     */
    contextLimit: number;
}
/**
 * 
 * @export
 * @interface ContextView
 */
export interface ContextView {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    consumer: Consumer;
    /**
     * 
     */
    workContextId?: string;
    /**
     * 
     */
    role: string;
    /**
     * 
     */
    blocks: Array<ContextBlock>;
    /**
     * 
     */
    selectedRefs: Array<Ref>;
    /**
     * 
     */
    inputPortions: Array<InputPortion>;
    /**
     * 
     */
    trimmed: Array<ContextViewTrimmedInner>;
    /**
     * 
     */
    model: ContextPrepareModel;
    /**
     * 
     */
    budget: ContextViewBudget;
    /**
     * 
     */
    effectivePolicy: ContextViewEffectivePolicy;
    /**
     * 
     */
    settingsSnapshots: { [key: string]: ConfigSnapshot; };
    /**
     * 
     */
    observed: TimePoint;
    /**
     * 
     */
    recorded: string;
}
/**
 * 
 * @export
 * @interface ContextViewBudget
 */
export interface ContextViewBudget {
    /**
     * 
     */
    availableTokens: number;
    /**
     * 
     */
    usedTokens: number;
    /**
     * 
     */
    reservedTokens: number;
    /**
     * 
     */
    estimate: ContextViewBudgetEstimateEnum;
}


/**
 * @export
 */
export const ContextViewBudgetEstimateEnum = {
    UnicodeCodePoints: 'unicode_code_points',
} as const;
export type ContextViewBudgetEstimateEnum = typeof ContextViewBudgetEstimateEnum[keyof typeof ContextViewBudgetEstimateEnum];

/**
 * 
 * @export
 * @interface ContextViewEffectivePolicy
 */
export interface ContextViewEffectivePolicy {
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    audience: Array<string>;
}
/**
 * 
 * @export
 * @interface ContextViewInput
 */
export interface ContextViewInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    consumer: ConsumerInput;
    /**
     * 
     */
    workContextId?: string;
    /**
     * 
     */
    role: string;
    /**
     * 
     */
    blocks: Array<ContextBlockInput>;
    /**
     * 
     */
    selectedRefs: Array<RefInput>;
    /**
     * 
     */
    inputPortions: Array<InputPortionInput>;
    /**
     * 
     */
    trimmed: Array<ContextViewInputTrimmedInner>;
    /**
     * 
     */
    model: ContextPrepareInputModel;
    /**
     * 
     */
    budget: ContextViewInputBudget;
    /**
     * 
     */
    effectivePolicy: ContextViewInputEffectivePolicy;
    /**
     * 
     */
    settingsSnapshots: { [key: string]: ConfigSnapshotInput; };
    /**
     * 
     */
    observed: TimePointInput;
    /**
     * 
     */
    recorded: string;
}
/**
 * 
 * @export
 * @interface ContextViewInputBudget
 */
export interface ContextViewInputBudget {
    /**
     * 
     */
    availableTokens: number;
    /**
     * 
     */
    usedTokens: number;
    /**
     * 
     */
    reservedTokens: number;
    /**
     * 
     */
    estimate: ContextViewInputBudgetEstimateEnum;
}


/**
 * @export
 */
export const ContextViewInputBudgetEstimateEnum = {
    UnicodeCodePoints: 'unicode_code_points',
} as const;
export type ContextViewInputBudgetEstimateEnum = typeof ContextViewInputBudgetEstimateEnum[keyof typeof ContextViewInputBudgetEstimateEnum];

/**
 * 
 * @export
 * @interface ContextViewInputEffectivePolicy
 */
export interface ContextViewInputEffectivePolicy {
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    audience: Array<string>;
}
/**
 * 
 * @export
 * @interface ContextViewInputTrimmedInner
 */
export interface ContextViewInputTrimmedInner {
    /**
     * 
     */
    ref?: RefInput;
    /**
     * 
     */
    reason: string;
    /**
     * 
     */
    originalCodePoints: number;
    /**
     * 
     */
    includedCodePoints: number;
}
/**
 * 
 * @export
 * @interface ContextViewTrimmedInner
 */
export interface ContextViewTrimmedInner {
    /**
     * 
     */
    ref?: Ref;
    /**
     * 
     */
    reason: string;
    /**
     * 
     */
    originalCodePoints: number;
    /**
     * 
     */
    includedCodePoints: number;
}
/**
 * 
 * @export
 * @interface CredentialsCreateManagementKeyRequest
 */
export interface CredentialsCreateManagementKeyRequest {
    /**
     * 
     */
    name: string;
}
/**
 * 
 * @export
 * @interface Criterion
 */
export interface Criterion {
    /**
     * 
     */
    mode: CriterionModeEnum;
    /**
     * 
     */
    range: TimeRange;
    /**
     * 
     */
    condition: string;
    /**
     * 
     */
    predicate?: CriterionPredicate;
    /**
     * 
     */
    requiredCoverage: number;
}


/**
 * @export
 */
export const CriterionModeEnum = {
    Achieve: 'achieve',
    Terminate: 'terminate',
    Maintain: 'maintain',
    Avoid: 'avoid',
} as const;
export type CriterionModeEnum = typeof CriterionModeEnum[keyof typeof CriterionModeEnum];

/**
 * 
 * @export
 * @interface CriterionInput
 */
export interface CriterionInput {
    /**
     * 
     */
    mode: CriterionInputModeEnum;
    /**
     * 
     */
    range: TimeRangeInput;
    /**
     * 
     */
    condition: string;
    /**
     * 
     */
    predicate?: CriterionInputPredicate;
    /**
     * 
     */
    requiredCoverage?: number;
}


/**
 * @export
 */
export const CriterionInputModeEnum = {
    Achieve: 'achieve',
    Terminate: 'terminate',
    Maintain: 'maintain',
    Avoid: 'avoid',
} as const;
export type CriterionInputModeEnum = typeof CriterionInputModeEnum[keyof typeof CriterionInputModeEnum];

/**
 * 
 * @export
 * @interface CriterionInputPredicate
 */
export interface CriterionInputPredicate {
    /**
     * 
     */
    path: Array<string>;
    /**
     * 
     */
    operator: CriterionInputPredicateOperatorEnum;
    /**
     * 
     */
    value?: CriterionInputPredicateValue | null;
}


/**
 * @export
 */
export const CriterionInputPredicateOperatorEnum = {
    Eq: 'eq',
    Neq: 'neq',
    Gt: 'gt',
    Gte: 'gte',
    Lt: 'lt',
    Lte: 'lte',
    Contains: 'contains',
    Exists: 'exists',
} as const;
export type CriterionInputPredicateOperatorEnum = typeof CriterionInputPredicateOperatorEnum[keyof typeof CriterionInputPredicateOperatorEnum];

/**
 * 
 * @export
 * @interface CriterionInputPredicateValue
 */
export interface CriterionInputPredicateValue {
}
/**
 * 
 * @export
 * @interface CriterionPredicate
 */
export interface CriterionPredicate {
    /**
     * 
     */
    path: Array<string>;
    /**
     * 
     */
    operator: CriterionPredicateOperatorEnum;
    /**
     * 
     */
    value?: CriterionInputPredicateValue | null;
}


/**
 * @export
 */
export const CriterionPredicateOperatorEnum = {
    Eq: 'eq',
    Neq: 'neq',
    Gt: 'gt',
    Gte: 'gte',
    Lt: 'lt',
    Lte: 'lte',
    Contains: 'contains',
    Exists: 'exists',
} as const;
export type CriterionPredicateOperatorEnum = typeof CriterionPredicateOperatorEnum[keyof typeof CriterionPredicateOperatorEnum];

/**
 * 
 * @export
 * @interface DelegationChildCreateBody
 */
export interface DelegationChildCreateBody {
    /**
     * 
     */
    name: string;
    /**
     * 
     */
    scope: DelegationChildCreateBodyScope;
    /**
     * 
     */
    principalKind: DelegationChildCreateBodyPrincipalKindEnum;
}


/**
 * @export
 */
export const DelegationChildCreateBodyPrincipalKindEnum = {
    Human: 'human',
    Service: 'service',
    Subject: 'subject',
    Worker: 'worker',
    Author: 'author',
} as const;
export type DelegationChildCreateBodyPrincipalKindEnum = typeof DelegationChildCreateBodyPrincipalKindEnum[keyof typeof DelegationChildCreateBodyPrincipalKindEnum];

/**
 * 
 * @export
 * @interface DelegationChildCreateBodyInput
 */
export interface DelegationChildCreateBodyInput {
    /**
     * 
     */
    name: string;
    /**
     * 
     */
    scope: DelegationsCreateRequestScope;
    /**
     * 
     */
    principalKind: DelegationChildCreateBodyInputPrincipalKindEnum;
}


/**
 * @export
 */
export const DelegationChildCreateBodyInputPrincipalKindEnum = {
    Human: 'human',
    Service: 'service',
    Subject: 'subject',
    Worker: 'worker',
    Author: 'author',
} as const;
export type DelegationChildCreateBodyInputPrincipalKindEnum = typeof DelegationChildCreateBodyInputPrincipalKindEnum[keyof typeof DelegationChildCreateBodyInputPrincipalKindEnum];

/**
 * 
 * @export
 * @interface DelegationChildCreateBodyScope
 */
export interface DelegationChildCreateBodyScope {
    /**
     * 
     */
    plane: DelegationChildCreateBodyScopePlaneEnum;
    /**
     * 
     */
    operations: Array<string>;
    /**
     * 
     */
    subjectIds: Array<string>;
    /**
     * 
     */
    consumer: Consumer;
    /**
     * 
     */
    purposes: Array<string>;
    /**
     * 
     */
    audiences: Array<string>;
    /**
     * 
     */
    targets: Array<DelegationChildCreateBodyScopeTargetsInner>;
    /**
     * 
     */
    inputRefs: Array<Ref>;
    /**
     * 
     */
    taskRef?: Ref;
    /**
     * 
     */
    nativeBinding?: DelegationChildCreateBodyScopeNativeBinding;
    /**
     * 
     */
    notBefore?: TimePointRequest;
    /**
     * 
     */
    expiresAt: TimePointRequest | null;
    /**
     * 
     */
    mayDelegate: boolean;
}


/**
 * @export
 */
export const DelegationChildCreateBodyScopePlaneEnum = {
    Subject: 'subject',
    System: 'system',
    Machine: 'machine',
    Recovery: 'recovery',
} as const;
export type DelegationChildCreateBodyScopePlaneEnum = typeof DelegationChildCreateBodyScopePlaneEnum[keyof typeof DelegationChildCreateBodyScopePlaneEnum];

/**
 * 
 * @export
 * @interface DelegationChildCreateBodyScopeNativeBinding
 */
export interface DelegationChildCreateBodyScopeNativeBinding {
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    sessionKey: string;
    /**
     * 
     */
    rootTaskId?: string;
}
/**
 * @type DelegationChildCreateBodyScopeTargetsInner
 * 
 * @export
 */
export type DelegationChildCreateBodyScopeTargetsInner = DelegationChildCreateBodyScopeTargetsInnerOneOf | DelegationChildCreateBodyScopeTargetsInnerOneOf1 | DelegationChildCreateBodyScopeTargetsInnerOneOf2 | DelegationChildCreateBodyScopeTargetsInnerOneOf3;
/**
 * 
 * @export
 * @interface DelegationChildCreateBodyScopeTargetsInnerOneOf
 */
export interface DelegationChildCreateBodyScopeTargetsInnerOneOf {
    /**
     * 
     */
    kind: DelegationChildCreateBodyScopeTargetsInnerOneOfKindEnum;
    /**
     * 
     */
    adapterId: string;
    /**
     * 
     */
    accountId: string;
    /**
     * 
     */
    conversationId: string;
    /**
     * 
     */
    actions: Array<string>;
}


/**
 * @export
 */
export const DelegationChildCreateBodyScopeTargetsInnerOneOfKindEnum = {
    Conversation: 'conversation',
} as const;
export type DelegationChildCreateBodyScopeTargetsInnerOneOfKindEnum = typeof DelegationChildCreateBodyScopeTargetsInnerOneOfKindEnum[keyof typeof DelegationChildCreateBodyScopeTargetsInnerOneOfKindEnum];

/**
 * 
 * @export
 * @interface DelegationChildCreateBodyScopeTargetsInnerOneOf1
 */
export interface DelegationChildCreateBodyScopeTargetsInnerOneOf1 {
    /**
     * 
     */
    kind: DelegationChildCreateBodyScopeTargetsInnerOneOf1KindEnum;
    /**
     * 
     */
    connectorId: string;
    /**
     * 
     */
    resourceIds: Array<string>;
    /**
     * 
     */
    actions: Array<string>;
}


/**
 * @export
 */
export const DelegationChildCreateBodyScopeTargetsInnerOneOf1KindEnum = {
    Resource: 'resource',
} as const;
export type DelegationChildCreateBodyScopeTargetsInnerOneOf1KindEnum = typeof DelegationChildCreateBodyScopeTargetsInnerOneOf1KindEnum[keyof typeof DelegationChildCreateBodyScopeTargetsInnerOneOf1KindEnum];

/**
 * 
 * @export
 * @interface DelegationChildCreateBodyScopeTargetsInnerOneOf2
 */
export interface DelegationChildCreateBodyScopeTargetsInnerOneOf2 {
    /**
     * 
     */
    kind: DelegationChildCreateBodyScopeTargetsInnerOneOf2KindEnum;
    /**
     * 
     */
    workspaceRef: Ref;
    /**
     * 
     */
    actions: Array<string>;
}


/**
 * @export
 */
export const DelegationChildCreateBodyScopeTargetsInnerOneOf2KindEnum = {
    Workspace: 'workspace',
} as const;
export type DelegationChildCreateBodyScopeTargetsInnerOneOf2KindEnum = typeof DelegationChildCreateBodyScopeTargetsInnerOneOf2KindEnum[keyof typeof DelegationChildCreateBodyScopeTargetsInnerOneOf2KindEnum];

/**
 * 
 * @export
 * @interface DelegationChildCreateBodyScopeTargetsInnerOneOf3
 */
export interface DelegationChildCreateBodyScopeTargetsInnerOneOf3 {
    /**
     * 
     */
    kind: DelegationChildCreateBodyScopeTargetsInnerOneOf3KindEnum;
    /**
     * 
     */
    refs: Array<Ref>;
    /**
     * 
     */
    actions: Array<string>;
}


/**
 * @export
 */
export const DelegationChildCreateBodyScopeTargetsInnerOneOf3KindEnum = {
    Object: 'object',
} as const;
export type DelegationChildCreateBodyScopeTargetsInnerOneOf3KindEnum = typeof DelegationChildCreateBodyScopeTargetsInnerOneOf3KindEnum[keyof typeof DelegationChildCreateBodyScopeTargetsInnerOneOf3KindEnum];

/**
 * 
 * @export
 * @interface DelegationChildView
 */
export interface DelegationChildView {
    /**
     * 
     */
    delegationId: string;
    /**
     * 
     */
    authorityRef: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    scope: DelegationChildCreateBodyScope;
}
/**
 * 
 * @export
 * @interface DelegationChildViewInput
 */
export interface DelegationChildViewInput {
    /**
     * 
     */
    delegationId: string;
    /**
     * 
     */
    authorityRef: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    scope: DelegationsCreateRequestScope;
}
/**
 * 
 * @export
 * @interface DelegationsCreateRequest
 */
export interface DelegationsCreateRequest {
    /**
     * 
     */
    name: string;
    /**
     * 
     */
    scope: DelegationsCreateRequestScope;
    /**
     * 
     */
    principalKind: DelegationsCreateRequestPrincipalKindEnum;
}


/**
 * @export
 */
export const DelegationsCreateRequestPrincipalKindEnum = {
    Subject: 'subject',
    Worker: 'worker',
    Author: 'author',
    Human: 'human',
    Service: 'service',
} as const;
export type DelegationsCreateRequestPrincipalKindEnum = typeof DelegationsCreateRequestPrincipalKindEnum[keyof typeof DelegationsCreateRequestPrincipalKindEnum];

/**
 * 
 * @export
 * @interface DelegationsCreateRequestScope
 */
export interface DelegationsCreateRequestScope {
    /**
     * 
     */
    plane: DelegationsCreateRequestScopePlaneEnum;
    /**
     * 
     */
    operations: Array<string>;
    /**
     * 
     */
    subjectIds: Array<string>;
    /**
     * 
     */
    consumer: ConsumerInput;
    /**
     * 
     */
    purposes: Array<string>;
    /**
     * 
     */
    audiences: Array<string>;
    /**
     * 
     */
    targets: Array<DelegationsCreateRequestScopeTargetsInner>;
    /**
     * 
     */
    inputRefs: Array<RefInput>;
    /**
     * 
     */
    taskRef?: RefInput;
    /**
     * 
     */
    nativeBinding?: DelegationsCreateRequestScopeNativeBinding;
    /**
     * 
     */
    notBefore?: TimePointRequestInput;
    /**
     * 
     */
    expiresAt: TimePointRequestInput | null;
    /**
     * 
     */
    mayDelegate: boolean;
}


/**
 * @export
 */
export const DelegationsCreateRequestScopePlaneEnum = {
    Subject: 'subject',
    System: 'system',
    Machine: 'machine',
    Recovery: 'recovery',
} as const;
export type DelegationsCreateRequestScopePlaneEnum = typeof DelegationsCreateRequestScopePlaneEnum[keyof typeof DelegationsCreateRequestScopePlaneEnum];

/**
 * 
 * @export
 * @interface DelegationsCreateRequestScopeNativeBinding
 */
export interface DelegationsCreateRequestScopeNativeBinding {
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    sessionKey: string;
    /**
     * 
     */
    rootTaskId?: string;
}
/**
 * @type DelegationsCreateRequestScopeTargetsInner
 * 
 * @export
 */
export type DelegationsCreateRequestScopeTargetsInner = DelegationsCreateRequestScopeTargetsInnerOneOf | DelegationsCreateRequestScopeTargetsInnerOneOf1 | DelegationsCreateRequestScopeTargetsInnerOneOf2 | DelegationsCreateRequestScopeTargetsInnerOneOf3;
/**
 * 
 * @export
 * @interface DelegationsCreateRequestScopeTargetsInnerOneOf
 */
export interface DelegationsCreateRequestScopeTargetsInnerOneOf {
    /**
     * 
     */
    kind: DelegationsCreateRequestScopeTargetsInnerOneOfKindEnum;
    /**
     * 
     */
    adapterId: string;
    /**
     * 
     */
    accountId: string;
    /**
     * 
     */
    conversationId: string;
    /**
     * 
     */
    actions: Array<string>;
}


/**
 * @export
 */
export const DelegationsCreateRequestScopeTargetsInnerOneOfKindEnum = {
    Conversation: 'conversation',
} as const;
export type DelegationsCreateRequestScopeTargetsInnerOneOfKindEnum = typeof DelegationsCreateRequestScopeTargetsInnerOneOfKindEnum[keyof typeof DelegationsCreateRequestScopeTargetsInnerOneOfKindEnum];

/**
 * 
 * @export
 * @interface DelegationsCreateRequestScopeTargetsInnerOneOf1
 */
export interface DelegationsCreateRequestScopeTargetsInnerOneOf1 {
    /**
     * 
     */
    kind: DelegationsCreateRequestScopeTargetsInnerOneOf1KindEnum;
    /**
     * 
     */
    connectorId: string;
    /**
     * 
     */
    resourceIds: Array<string>;
    /**
     * 
     */
    actions: Array<string>;
}


/**
 * @export
 */
export const DelegationsCreateRequestScopeTargetsInnerOneOf1KindEnum = {
    Resource: 'resource',
} as const;
export type DelegationsCreateRequestScopeTargetsInnerOneOf1KindEnum = typeof DelegationsCreateRequestScopeTargetsInnerOneOf1KindEnum[keyof typeof DelegationsCreateRequestScopeTargetsInnerOneOf1KindEnum];

/**
 * 
 * @export
 * @interface DelegationsCreateRequestScopeTargetsInnerOneOf2
 */
export interface DelegationsCreateRequestScopeTargetsInnerOneOf2 {
    /**
     * 
     */
    kind: DelegationsCreateRequestScopeTargetsInnerOneOf2KindEnum;
    /**
     * 
     */
    workspaceRef: RefInput;
    /**
     * 
     */
    actions: Array<string>;
}


/**
 * @export
 */
export const DelegationsCreateRequestScopeTargetsInnerOneOf2KindEnum = {
    Workspace: 'workspace',
} as const;
export type DelegationsCreateRequestScopeTargetsInnerOneOf2KindEnum = typeof DelegationsCreateRequestScopeTargetsInnerOneOf2KindEnum[keyof typeof DelegationsCreateRequestScopeTargetsInnerOneOf2KindEnum];

/**
 * 
 * @export
 * @interface DelegationsCreateRequestScopeTargetsInnerOneOf3
 */
export interface DelegationsCreateRequestScopeTargetsInnerOneOf3 {
    /**
     * 
     */
    kind: DelegationsCreateRequestScopeTargetsInnerOneOf3KindEnum;
    /**
     * 
     */
    refs: Array<RefInput>;
    /**
     * 
     */
    actions: Array<string>;
}


/**
 * @export
 */
export const DelegationsCreateRequestScopeTargetsInnerOneOf3KindEnum = {
    Object: 'object',
} as const;
export type DelegationsCreateRequestScopeTargetsInnerOneOf3KindEnum = typeof DelegationsCreateRequestScopeTargetsInnerOneOf3KindEnum[keyof typeof DelegationsCreateRequestScopeTargetsInnerOneOf3KindEnum];

/**
 * 
 * @export
 * @interface DelegationsUpdateRequest
 */
export interface DelegationsUpdateRequest {
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    scope: DelegationsCreateRequestScope;
}
/**
 * 
 * @export
 * @interface EffectiveSettingsView
 */
export interface EffectiveSettingsView {
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    modules: { [key: string]: ConfigSnapshot; };
    /**
     * 
     */
    targetOverrides: { [key: string]: EffectiveSettingsViewTargetOverridesValue; };
}
/**
 * 
 * @export
 * @interface EffectiveSettingsViewInput
 */
export interface EffectiveSettingsViewInput {
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    modules: { [key: string]: ConfigSnapshotInput; };
    /**
     * 
     */
    targetOverrides: { [key: string]: EffectiveSettingsViewInputTargetOverridesValue; };
}
/**
 * 
 * @export
 * @interface EffectiveSettingsViewInputTargetOverridesValue
 */
export interface EffectiveSettingsViewInputTargetOverridesValue {
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    sparse: { [key: string]: JsonValueInput; };
}
/**
 * 
 * @export
 * @interface EffectiveSettingsViewTargetOverridesValue
 */
export interface EffectiveSettingsViewTargetOverridesValue {
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    sparse: { [key: string]: JsonValue; };
}
/**
 * 
 * @export
 * @interface EncounterAccept
 */
export interface EncounterAccept {
    /**
     * 
     */
    consumer: Consumer;
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    step: EncounterAcceptInputStep;
    /**
     * 
     */
    contextViewRef?: Ref;
    /**
     * 
     */
    portions: Array<Portion>;
    /**
     * 
     */
    resultRef?: Ref;
    /**
     * 
     */
    observed: TimePointRequest;
    /**
     * 
     */
    occurred?: TimeRangeRequest;
    /**
     * 
     */
    activityRef?: Ref;
    /**
     * 
     */
    contextRef?: Ref;
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    completion: EncounterAcceptCompletionEnum;
}


/**
 * @export
 */
export const EncounterAcceptCompletionEnum = {
    Complete: 'complete',
    UsablePartial: 'usable_partial',
} as const;
export type EncounterAcceptCompletionEnum = typeof EncounterAcceptCompletionEnum[keyof typeof EncounterAcceptCompletionEnum];

/**
 * 
 * @export
 * @interface EncounterAcceptInput
 */
export interface EncounterAcceptInput {
    /**
     * 
     */
    consumer: ConsumerInput;
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    step: EncounterAcceptInputStep;
    /**
     * 
     */
    contextViewRef?: RefInput;
    /**
     * 
     */
    portions: Array<PortionInput>;
    /**
     * 
     */
    resultRef?: RefInput;
    /**
     * 
     */
    observed: TimePointRequestInput;
    /**
     * 
     */
    occurred?: TimeRangeRequestInput;
    /**
     * 
     */
    activityRef?: RefInput;
    /**
     * 
     */
    contextRef?: RefInput;
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    completion?: EncounterAcceptInputCompletionEnum;
}


/**
 * @export
 */
export const EncounterAcceptInputCompletionEnum = {
    Complete: 'complete',
    UsablePartial: 'usable_partial',
} as const;
export type EncounterAcceptInputCompletionEnum = typeof EncounterAcceptInputCompletionEnum[keyof typeof EncounterAcceptInputCompletionEnum];

/**
 * 
 * @export
 * @interface EncounterAcceptInputStep
 */
export interface EncounterAcceptInputStep {
}
/**
 * 
 * @export
 * @interface EncounterView
 */
export interface EncounterView {
    /**
     * 
     */
    consumer: Consumer;
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    step: EncounterAcceptInputStep;
    /**
     * 
     */
    contextViewRef?: Ref;
    /**
     * 
     */
    portions: Array<Portion>;
    /**
     * 
     */
    resultRef?: Ref;
    /**
     * 
     */
    observed: TimePoint;
    /**
     * 
     */
    occurred?: TimeRange;
    /**
     * 
     */
    activityRef?: Ref;
    /**
     * 
     */
    contextRef?: Ref;
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    completion: EncounterViewCompletionEnum;
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    recordedAt: string;
}


/**
 * @export
 */
export const EncounterViewCompletionEnum = {
    Complete: 'complete',
    UsablePartial: 'usable_partial',
} as const;
export type EncounterViewCompletionEnum = typeof EncounterViewCompletionEnum[keyof typeof EncounterViewCompletionEnum];

/**
 * 
 * @export
 * @interface EncounterViewInput
 */
export interface EncounterViewInput {
    /**
     * 
     */
    consumer: ConsumerInput;
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    step: EncounterAcceptInputStep;
    /**
     * 
     */
    contextViewRef?: RefInput;
    /**
     * 
     */
    portions: Array<PortionInput>;
    /**
     * 
     */
    resultRef?: RefInput;
    /**
     * 
     */
    observed: TimePointInput;
    /**
     * 
     */
    occurred?: TimeRangeInput;
    /**
     * 
     */
    activityRef?: RefInput;
    /**
     * 
     */
    contextRef?: RefInput;
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    completion?: EncounterViewInputCompletionEnum;
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    recordedAt: string;
}


/**
 * @export
 */
export const EncounterViewInputCompletionEnum = {
    Complete: 'complete',
    UsablePartial: 'usable_partial',
} as const;
export type EncounterViewInputCompletionEnum = typeof EncounterViewInputCompletionEnum[keyof typeof EncounterViewInputCompletionEnum];

/**
 * 
 * @export
 * @interface Episode
 */
export interface Episode {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: EpisodeKindEnum;
    /**
     * 
     */
    track: EpisodeTrackEnum;
    /**
     * 
     */
    range: TimeRange;
    /**
     * 
     */
    members: Array<Ref>;
    /**
     * 
     */
    participants: Array<Ref>;
    /**
     * 
     */
    placeRef?: Ref;
    /**
     * 
     */
    parentRef?: Ref;
}


/**
 * @export
 */
export const EpisodeKindEnum = {
    Episode: 'Episode',
} as const;
export type EpisodeKindEnum = typeof EpisodeKindEnum[keyof typeof EpisodeKindEnum];

/**
 * @export
 */
export const EpisodeTrackEnum = {
    Life: 'life',
    Social: 'social',
    Work: 'work',
} as const;
export type EpisodeTrackEnum = typeof EpisodeTrackEnum[keyof typeof EpisodeTrackEnum];

/**
 * 
 * @export
 * @interface EpisodeInput
 */
export interface EpisodeInput {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: EpisodeInputKindEnum;
    /**
     * 
     */
    track: EpisodeInputTrackEnum;
    /**
     * 
     */
    range: TimeRangeInput;
    /**
     * 
     */
    members: Array<RefInput>;
    /**
     * 
     */
    participants?: Array<RefInput>;
    /**
     * 
     */
    placeRef?: RefInput;
    /**
     * 
     */
    parentRef?: RefInput;
}


/**
 * @export
 */
export const EpisodeInputKindEnum = {
    Episode: 'Episode',
} as const;
export type EpisodeInputKindEnum = typeof EpisodeInputKindEnum[keyof typeof EpisodeInputKindEnum];

/**
 * @export
 */
export const EpisodeInputTrackEnum = {
    Life: 'life',
    Social: 'social',
    Work: 'work',
} as const;
export type EpisodeInputTrackEnum = typeof EpisodeInputTrackEnum[keyof typeof EpisodeInputTrackEnum];

/**
 * 
 * @export
 * @interface Expand
 */
export interface Expand {
    /**
     * 
     */
    refs: Array<Ref>;
    /**
     * 
     */
    include: Array<ExpandIncludeEnum>;
    /**
     * 
     */
    depth: number;
    /**
     * 
     */
    limit: number;
}


/**
 * @export
 */
export const ExpandIncludeEnum = {
    Sources: 'sources',
    Relations: 'relations',
} as const;
export type ExpandIncludeEnum = typeof ExpandIncludeEnum[keyof typeof ExpandIncludeEnum];

/**
 * 
 * @export
 * @interface ExpandInput
 */
export interface ExpandInput {
    /**
     * 
     */
    refs: Array<RefInput>;
    /**
     * 
     */
    include?: Array<ExpandInputIncludeEnum>;
    /**
     * 
     */
    depth?: number;
    /**
     * 
     */
    limit?: number;
}


/**
 * @export
 */
export const ExpandInputIncludeEnum = {
    Sources: 'sources',
    Relations: 'relations',
} as const;
export type ExpandInputIncludeEnum = typeof ExpandInputIncludeEnum[keyof typeof ExpandInputIncludeEnum];

/**
 * 
 * @export
 * @interface ExpansionResult
 */
export interface ExpansionResult {
    /**
     * 
     */
    items: Array<QueryItem>;
    /**
     * 
     */
    sources: Array<MaterialView>;
    /**
     * 
     */
    relations: Array<ExpansionResultRelationsInner>;
}
/**
 * 
 * @export
 * @interface ExpansionResultInput
 */
export interface ExpansionResultInput {
    /**
     * 
     */
    items: Array<QueryItemInput>;
    /**
     * 
     */
    sources: Array<MaterialViewInput>;
    /**
     * 
     */
    relations: Array<ExpansionResultInputRelationsInner>;
}
/**
 * 
 * @export
 * @interface ExpansionResultInputRelationsInner
 */
export interface ExpansionResultInputRelationsInner {
    /**
     * 
     */
    from: RefInput;
    /**
     * 
     */
    to: RefInput;
    /**
     * 
     */
    relation: string;
    /**
     * 
     */
    weight: number;
}
/**
 * 
 * @export
 * @interface ExpansionResultRelationsInner
 */
export interface ExpansionResultRelationsInner {
    /**
     * 
     */
    from: Ref;
    /**
     * 
     */
    to: Ref;
    /**
     * 
     */
    relation: string;
    /**
     * 
     */
    weight: number;
}
/**
 * 
 * @export
 * @interface ExperienceItem
 */
export interface ExperienceItem {
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    encounterRef: Ref;
    /**
     * 
     */
    observed: TimePoint;
    /**
     * 
     */
    portions: Array<Portion>;
    /**
     * 
     */
    activityRef?: Ref;
    /**
     * 
     */
    contextRef?: Ref;
    /**
     * 
     */
    sourceRoots: Array<Ref>;
}
/**
 * 
 * @export
 * @interface ExperienceItemInput
 */
export interface ExperienceItemInput {
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    encounterRef: RefInput;
    /**
     * 
     */
    observed: TimePointInput;
    /**
     * 
     */
    portions: Array<PortionInput>;
    /**
     * 
     */
    activityRef?: RefInput;
    /**
     * 
     */
    contextRef?: RefInput;
    /**
     * 
     */
    sourceRoots: Array<RefInput>;
}
/**
 * 
 * @export
 * @interface ExperienceList
 */
export interface ExperienceList {
    /**
     * 
     */
    refs?: Array<Ref>;
    /**
     * 
     */
    range?: TimeRangeRequest;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit: number;
}
/**
 * 
 * @export
 * @interface ExperienceListInput
 */
export interface ExperienceListInput {
    /**
     * 
     */
    refs?: Array<RefInput>;
    /**
     * 
     */
    range?: TimeRangeRequestInput;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
}
/**
 * 
 * @export
 * @interface ExperiencePage
 */
export interface ExperiencePage {
    /**
     * 
     */
    items: Array<ExperienceItem>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface ExperiencePageInput
 */
export interface ExperiencePageInput {
    /**
     * 
     */
    items: Array<ExperienceItemInput>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface Feedback
 */
export interface Feedback {
    /**
     * 
     */
    stepKey: string;
    /**
     * 
     */
    kind: FeedbackKindEnum;
    /**
     * 
     */
    refs: Array<Ref>;
    /**
     * 
     */
    basisRefs: Array<Ref>;
}


/**
 * @export
 */
export const FeedbackKindEnum = {
    Presented: 'presented',
    Cited: 'cited',
    Adopted: 'adopted',
    Outcome: 'outcome',
    Corrected: 'corrected',
} as const;
export type FeedbackKindEnum = typeof FeedbackKindEnum[keyof typeof FeedbackKindEnum];

/**
 * 
 * @export
 * @interface FeedbackInput
 */
export interface FeedbackInput {
    /**
     * 
     */
    stepKey: string;
    /**
     * 
     */
    kind: FeedbackInputKindEnum;
    /**
     * 
     */
    refs: Array<RefInput>;
    /**
     * 
     */
    basisRefs?: Array<RefInput>;
}


/**
 * @export
 */
export const FeedbackInputKindEnum = {
    Presented: 'presented',
    Cited: 'cited',
    Adopted: 'adopted',
    Outcome: 'outcome',
    Corrected: 'corrected',
} as const;
export type FeedbackInputKindEnum = typeof FeedbackInputKindEnum[keyof typeof FeedbackInputKindEnum];

/**
 * 
 * @export
 * @interface FieldMetadata
 */
export interface FieldMetadata {
    /**
     * 
     */
    labelKey: string;
    /**
     * 
     */
    descriptionKey: string;
    /**
     * 
     */
    scopes: Array<FieldMetadataScopesEnum>;
    /**
     * 
     */
    visibility: FieldMetadataVisibilityEnum;
    /**
     * 
     */
    effect: FieldMetadataEffectEnum;
    /**
     * 
     */
    unit?: string;
    /**
     * 
     */
    readonly?: boolean;
    /**
     * 
     */
    restriction?: FieldMetadataRestrictionEnum;
    /**
     * 
     */
    consumerIds: Array<string>;
}


/**
 * @export
 */
export const FieldMetadataScopesEnum = {
    Installation: 'installation',
    Subject: 'subject',
    Role: 'role',
} as const;
export type FieldMetadataScopesEnum = typeof FieldMetadataScopesEnum[keyof typeof FieldMetadataScopesEnum];

/**
 * @export
 */
export const FieldMetadataVisibilityEnum = {
    Standard: 'standard',
    Advanced: 'advanced',
    Developer: 'developer',
} as const;
export type FieldMetadataVisibilityEnum = typeof FieldMetadataVisibilityEnum[keyof typeof FieldMetadataVisibilityEnum];

/**
 * @export
 */
export const FieldMetadataEffectEnum = {
    Hot: 'hot',
    NextCall: 'next_call',
    Restart: 'restart',
} as const;
export type FieldMetadataEffectEnum = typeof FieldMetadataEffectEnum[keyof typeof FieldMetadataEffectEnum];

/**
 * @export
 */
export const FieldMetadataRestrictionEnum = {
    UpperBound: 'upper_bound',
    SetIntersection: 'set_intersection',
} as const;
export type FieldMetadataRestrictionEnum = typeof FieldMetadataRestrictionEnum[keyof typeof FieldMetadataRestrictionEnum];

/**
 * 
 * @export
 * @interface FieldMetadataInput
 */
export interface FieldMetadataInput {
    /**
     * 
     */
    labelKey: string;
    /**
     * 
     */
    descriptionKey: string;
    /**
     * 
     */
    scopes: Array<FieldMetadataInputScopesEnum>;
    /**
     * 
     */
    visibility: FieldMetadataInputVisibilityEnum;
    /**
     * 
     */
    effect: FieldMetadataInputEffectEnum;
    /**
     * 
     */
    unit?: string;
    /**
     * 
     */
    readonly?: boolean;
    /**
     * 
     */
    restriction?: FieldMetadataInputRestrictionEnum;
    /**
     * 
     */
    consumerIds: Array<string>;
}


/**
 * @export
 */
export const FieldMetadataInputScopesEnum = {
    Installation: 'installation',
    Subject: 'subject',
    Role: 'role',
} as const;
export type FieldMetadataInputScopesEnum = typeof FieldMetadataInputScopesEnum[keyof typeof FieldMetadataInputScopesEnum];

/**
 * @export
 */
export const FieldMetadataInputVisibilityEnum = {
    Standard: 'standard',
    Advanced: 'advanced',
    Developer: 'developer',
} as const;
export type FieldMetadataInputVisibilityEnum = typeof FieldMetadataInputVisibilityEnum[keyof typeof FieldMetadataInputVisibilityEnum];

/**
 * @export
 */
export const FieldMetadataInputEffectEnum = {
    Hot: 'hot',
    NextCall: 'next_call',
    Restart: 'restart',
} as const;
export type FieldMetadataInputEffectEnum = typeof FieldMetadataInputEffectEnum[keyof typeof FieldMetadataInputEffectEnum];

/**
 * @export
 */
export const FieldMetadataInputRestrictionEnum = {
    UpperBound: 'upper_bound',
    SetIntersection: 'set_intersection',
} as const;
export type FieldMetadataInputRestrictionEnum = typeof FieldMetadataInputRestrictionEnum[keyof typeof FieldMetadataInputRestrictionEnum];

/**
 * 
 * @export
 * @interface FormationArtifact
 */
export interface FormationArtifact {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    purpose: FormationArtifactPurposeEnum;
    /**
     * 
     */
    previousArtifactRef?: Ref;
    /**
     * 
     */
    appliedArtifactRef?: Ref;
    /**
     * 
     */
    experienceRefs: Array<Ref>;
    /**
     * 
     */
    sourceRefs: Array<Ref>;
    /**
     * 
     */
    changeSet: ChangeSet;
    /**
     * 
     */
    groups: Array<FormationArtifactGroupsInner>;
    /**
     * 
     */
    modelOperationId?: string;
    /**
     * 
     */
    resolutions: Array<FormationArtifactResolutionsInner>;
    /**
     * 
     */
    modelOutputRef?: Ref;
    /**
     * 
     */
    recorded: string;
}


/**
 * @export
 */
export const FormationArtifactPurposeEnum = {
    Growth: 'growth',
    Seed: 'seed',
} as const;
export type FormationArtifactPurposeEnum = typeof FormationArtifactPurposeEnum[keyof typeof FormationArtifactPurposeEnum];

/**
 * 
 * @export
 * @interface FormationArtifactGroupsInner
 */
export interface FormationArtifactGroupsInner {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    status: FormationArtifactGroupsInnerStatusEnum;
    /**
     * 
     */
    issues: Array<string>;
    /**
     * 
     */
    createdRefs: Array<Ref>;
    /**
     * 
     */
    revisedRefs: Array<Ref>;
    /**
     * 
     */
    conflicts: Array<FormationArtifactGroupsInnerConflictsInner>;
}


/**
 * @export
 */
export const FormationArtifactGroupsInnerStatusEnum = {
    Pending: 'pending',
    Applied: 'applied',
    Conflict: 'conflict',
    Invalid: 'invalid',
    Discarded: 'discarded',
} as const;
export type FormationArtifactGroupsInnerStatusEnum = typeof FormationArtifactGroupsInnerStatusEnum[keyof typeof FormationArtifactGroupsInnerStatusEnum];

/**
 * 
 * @export
 * @interface FormationArtifactGroupsInnerConflictsInner
 */
export interface FormationArtifactGroupsInnerConflictsInner {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    currentRevision?: number;
}
/**
 * 
 * @export
 * @interface FormationArtifactInput
 */
export interface FormationArtifactInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    purpose?: FormationArtifactInputPurposeEnum;
    /**
     * 
     */
    previousArtifactRef?: RefInput;
    /**
     * 
     */
    appliedArtifactRef?: RefInput;
    /**
     * 
     */
    experienceRefs: Array<RefInput>;
    /**
     * 
     */
    sourceRefs: Array<RefInput>;
    /**
     * 
     */
    changeSet: ChangeSetInput;
    /**
     * 
     */
    groups: Array<FormationArtifactInputGroupsInner>;
    /**
     * 
     */
    modelOperationId?: string;
    /**
     * 
     */
    resolutions?: Array<FormationArtifactInputResolutionsInner>;
    /**
     * 
     */
    modelOutputRef?: RefInput;
    /**
     * 
     */
    recorded: string;
}


/**
 * @export
 */
export const FormationArtifactInputPurposeEnum = {
    Growth: 'growth',
    Seed: 'seed',
} as const;
export type FormationArtifactInputPurposeEnum = typeof FormationArtifactInputPurposeEnum[keyof typeof FormationArtifactInputPurposeEnum];

/**
 * 
 * @export
 * @interface FormationArtifactInputGroupsInner
 */
export interface FormationArtifactInputGroupsInner {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    status: FormationArtifactInputGroupsInnerStatusEnum;
    /**
     * 
     */
    issues?: Array<string>;
    /**
     * 
     */
    createdRefs: Array<RefInput>;
    /**
     * 
     */
    revisedRefs: Array<RefInput>;
    /**
     * 
     */
    conflicts: Array<FormationArtifactInputGroupsInnerConflictsInner>;
}


/**
 * @export
 */
export const FormationArtifactInputGroupsInnerStatusEnum = {
    Pending: 'pending',
    Applied: 'applied',
    Conflict: 'conflict',
    Invalid: 'invalid',
    Discarded: 'discarded',
} as const;
export type FormationArtifactInputGroupsInnerStatusEnum = typeof FormationArtifactInputGroupsInnerStatusEnum[keyof typeof FormationArtifactInputGroupsInnerStatusEnum];

/**
 * 
 * @export
 * @interface FormationArtifactInputGroupsInnerConflictsInner
 */
export interface FormationArtifactInputGroupsInnerConflictsInner {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    currentRevision?: number;
}
/**
 * 
 * @export
 * @interface FormationArtifactInputResolutionsInner
 */
export interface FormationArtifactInputResolutionsInner {
    /**
     * 
     */
    groupIds: Array<string>;
    /**
     * 
     */
    previous: ChangeSetInput;
    /**
     * 
     */
    action: FormationArtifactInputResolutionsInnerActionEnum;
    /**
     * 
     */
    reason: string;
    /**
     * 
     */
    at: TimePointInput;
    /**
     * 
     */
    modelOperationId?: string;
}


/**
 * @export
 */
export const FormationArtifactInputResolutionsInnerActionEnum = {
    Edit: 'edit',
    Rejudge: 'rejudge',
    Discard: 'discard',
} as const;
export type FormationArtifactInputResolutionsInnerActionEnum = typeof FormationArtifactInputResolutionsInnerActionEnum[keyof typeof FormationArtifactInputResolutionsInnerActionEnum];

/**
 * 
 * @export
 * @interface FormationArtifactResolutionsInner
 */
export interface FormationArtifactResolutionsInner {
    /**
     * 
     */
    groupIds: Array<string>;
    /**
     * 
     */
    previous: ChangeSet;
    /**
     * 
     */
    action: FormationArtifactResolutionsInnerActionEnum;
    /**
     * 
     */
    reason: string;
    /**
     * 
     */
    at: TimePoint;
    /**
     * 
     */
    modelOperationId?: string;
}


/**
 * @export
 */
export const FormationArtifactResolutionsInnerActionEnum = {
    Edit: 'edit',
    Rejudge: 'rejudge',
    Discard: 'discard',
} as const;
export type FormationArtifactResolutionsInnerActionEnum = typeof FormationArtifactResolutionsInnerActionEnum[keyof typeof FormationArtifactResolutionsInnerActionEnum];

/**
 * 
 * @export
 * @interface GrowthResolve
 */
export interface GrowthResolve {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    groupIds: Array<string>;
    /**
     * 
     */
    action: GrowthResolveActionEnum;
    /**
     * 
     */
    groups?: Array<ChangeSetGroupsInner>;
    /**
     * 
     */
    formed: TimePointRequest;
    /**
     * 
     */
    reason: string;
}


/**
 * @export
 */
export const GrowthResolveActionEnum = {
    Edit: 'edit',
    Rejudge: 'rejudge',
    Discard: 'discard',
} as const;
export type GrowthResolveActionEnum = typeof GrowthResolveActionEnum[keyof typeof GrowthResolveActionEnum];

/**
 * 
 * @export
 * @interface GrowthResolveInput
 */
export interface GrowthResolveInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    groupIds: Array<string>;
    /**
     * 
     */
    action: GrowthResolveInputActionEnum;
    /**
     * 
     */
    groups?: Array<ChangeSetInputGroupsInner>;
    /**
     * 
     */
    formed: TimePointRequestInput;
    /**
     * 
     */
    reason: string;
}


/**
 * @export
 */
export const GrowthResolveInputActionEnum = {
    Edit: 'edit',
    Rejudge: 'rejudge',
    Discard: 'discard',
} as const;
export type GrowthResolveInputActionEnum = typeof GrowthResolveInputActionEnum[keyof typeof GrowthResolveInputActionEnum];

/**
 * 
 * @export
 * @interface HeptHostStatus
 */
export interface HeptHostStatus {
    /**
     * 
     */
    product: HeptHostStatusProductEnum;
    /**
     * 
     */
    installationId: string;
    /**
     * 
     */
    state: HeptHostStatusStateEnum;
    /**
     * 
     */
    process: HeptHostStatusProcess;
    /**
     * 
     */
    database: HeptHostStatusDatabase;
    /**
     * 
     */
    auth: HeptHostStatusDatabase;
    /**
     * 
     */
    native: HeptHostStatusNative;
    /**
     * 
     */
    models: HeptHostStatusModels;
    /**
     * 
     */
    index: HeptHostStatusNative;
    /**
     * 
     */
    channels: HeptHostStatusChannels;
    /**
     * 
     */
    subjects: HeptHostStatusSubjects;
}


/**
 * @export
 */
export const HeptHostStatusProductEnum = {
    Hept: 'hept',
} as const;
export type HeptHostStatusProductEnum = typeof HeptHostStatusProductEnum[keyof typeof HeptHostStatusProductEnum];

/**
 * @export
 */
export const HeptHostStatusStateEnum = {
    Initialized: 'initialized',
    Running: 'running',
    Draining: 'draining',
    Stopped: 'stopped',
} as const;
export type HeptHostStatusStateEnum = typeof HeptHostStatusStateEnum[keyof typeof HeptHostStatusStateEnum];

/**
 * 
 * @export
 * @interface HeptHostStatusChannels
 */
export interface HeptHostStatusChannels {
    /**
     * 
     */
    local: HeptHostStatusDatabase;
    /**
     * 
     */
    configured: string;
    /**
     * 
     */
    externalProbe: string;
}
/**
 * 
 * @export
 * @interface HeptHostStatusDatabase
 */
export interface HeptHostStatusDatabase {
    /**
     * 
     */
    state: HeptHostStatusDatabaseStateEnum;
}


/**
 * @export
 */
export const HeptHostStatusDatabaseStateEnum = {
    Available: 'available',
    Degraded: 'degraded',
    Unavailable: 'unavailable',
} as const;
export type HeptHostStatusDatabaseStateEnum = typeof HeptHostStatusDatabaseStateEnum[keyof typeof HeptHostStatusDatabaseStateEnum];

/**
 * 
 * @export
 * @interface HeptHostStatusInput
 */
export interface HeptHostStatusInput {
    /**
     * 
     */
    product: HeptHostStatusInputProductEnum;
    /**
     * 
     */
    installationId: string;
    /**
     * 
     */
    state: HeptHostStatusInputStateEnum;
    /**
     * 
     */
    process: HeptHostStatusInputProcess;
    /**
     * 
     */
    database: HeptHostStatusInputDatabase;
    /**
     * 
     */
    auth: HeptHostStatusInputDatabase;
    /**
     * 
     */
    native: HeptHostStatusInputNative;
    /**
     * 
     */
    models: HeptHostStatusInputModels;
    /**
     * 
     */
    index: HeptHostStatusInputNative;
    /**
     * 
     */
    channels: HeptHostStatusInputChannels;
    /**
     * 
     */
    subjects: HeptHostStatusInputSubjects;
}


/**
 * @export
 */
export const HeptHostStatusInputProductEnum = {
    Hept: 'hept',
} as const;
export type HeptHostStatusInputProductEnum = typeof HeptHostStatusInputProductEnum[keyof typeof HeptHostStatusInputProductEnum];

/**
 * @export
 */
export const HeptHostStatusInputStateEnum = {
    Initialized: 'initialized',
    Running: 'running',
    Draining: 'draining',
    Stopped: 'stopped',
} as const;
export type HeptHostStatusInputStateEnum = typeof HeptHostStatusInputStateEnum[keyof typeof HeptHostStatusInputStateEnum];

/**
 * 
 * @export
 * @interface HeptHostStatusInputChannels
 */
export interface HeptHostStatusInputChannels {
    /**
     * 
     */
    local: HeptHostStatusInputDatabase;
    /**
     * 
     */
    configured: string;
    /**
     * 
     */
    externalProbe: string;
}
/**
 * 
 * @export
 * @interface HeptHostStatusInputDatabase
 */
export interface HeptHostStatusInputDatabase {
    /**
     * 
     */
    state: HeptHostStatusInputDatabaseStateEnum;
}


/**
 * @export
 */
export const HeptHostStatusInputDatabaseStateEnum = {
    Available: 'available',
    Degraded: 'degraded',
    Unavailable: 'unavailable',
} as const;
export type HeptHostStatusInputDatabaseStateEnum = typeof HeptHostStatusInputDatabaseStateEnum[keyof typeof HeptHostStatusInputDatabaseStateEnum];

/**
 * 
 * @export
 * @interface HeptHostStatusInputModels
 */
export interface HeptHostStatusInputModels {
    /**
     * 
     */
    state: HeptHostStatusInputModelsStateEnum;
    /**
     * 
     */
    required: boolean;
    /**
     * 
     */
    configured: string;
    /**
     * 
     */
    reason: string;
}


/**
 * @export
 */
export const HeptHostStatusInputModelsStateEnum = {
    Available: 'available',
    Degraded: 'degraded',
    Unavailable: 'unavailable',
} as const;
export type HeptHostStatusInputModelsStateEnum = typeof HeptHostStatusInputModelsStateEnum[keyof typeof HeptHostStatusInputModelsStateEnum];

/**
 * 
 * @export
 * @interface HeptHostStatusInputNative
 */
export interface HeptHostStatusInputNative {
    /**
     * 
     */
    state: HeptHostStatusInputNativeStateEnum;
    /**
     * 
     */
    required: boolean;
    /**
     * 
     */
    reason: string;
}


/**
 * @export
 */
export const HeptHostStatusInputNativeStateEnum = {
    Available: 'available',
    Degraded: 'degraded',
    Unavailable: 'unavailable',
} as const;
export type HeptHostStatusInputNativeStateEnum = typeof HeptHostStatusInputNativeStateEnum[keyof typeof HeptHostStatusInputNativeStateEnum];

/**
 * 
 * @export
 * @interface HeptHostStatusInputProcess
 */
export interface HeptHostStatusInputProcess {
    /**
     * 
     */
    state: HeptHostStatusInputProcessStateEnum;
    /**
     * 
     */
    acceptingWork: boolean;
}


/**
 * @export
 */
export const HeptHostStatusInputProcessStateEnum = {
    Available: 'available',
    Degraded: 'degraded',
    Unavailable: 'unavailable',
} as const;
export type HeptHostStatusInputProcessStateEnum = typeof HeptHostStatusInputProcessStateEnum[keyof typeof HeptHostStatusInputProcessStateEnum];

/**
 * 
 * @export
 * @interface HeptHostStatusInputSubjects
 */
export interface HeptHostStatusInputSubjects {
    /**
     * 
     */
    count: string;
    /**
     * 
     */
    running: string;
}
/**
 * 
 * @export
 * @interface HeptHostStatusModels
 */
export interface HeptHostStatusModels {
    /**
     * 
     */
    state: HeptHostStatusModelsStateEnum;
    /**
     * 
     */
    required: boolean;
    /**
     * 
     */
    configured: string;
    /**
     * 
     */
    reason: string;
}


/**
 * @export
 */
export const HeptHostStatusModelsStateEnum = {
    Available: 'available',
    Degraded: 'degraded',
    Unavailable: 'unavailable',
} as const;
export type HeptHostStatusModelsStateEnum = typeof HeptHostStatusModelsStateEnum[keyof typeof HeptHostStatusModelsStateEnum];

/**
 * 
 * @export
 * @interface HeptHostStatusNative
 */
export interface HeptHostStatusNative {
    /**
     * 
     */
    state: HeptHostStatusNativeStateEnum;
    /**
     * 
     */
    required: boolean;
    /**
     * 
     */
    reason: string;
}


/**
 * @export
 */
export const HeptHostStatusNativeStateEnum = {
    Available: 'available',
    Degraded: 'degraded',
    Unavailable: 'unavailable',
} as const;
export type HeptHostStatusNativeStateEnum = typeof HeptHostStatusNativeStateEnum[keyof typeof HeptHostStatusNativeStateEnum];

/**
 * 
 * @export
 * @interface HeptHostStatusProcess
 */
export interface HeptHostStatusProcess {
    /**
     * 
     */
    state: HeptHostStatusProcessStateEnum;
    /**
     * 
     */
    acceptingWork: boolean;
}


/**
 * @export
 */
export const HeptHostStatusProcessStateEnum = {
    Available: 'available',
    Degraded: 'degraded',
    Unavailable: 'unavailable',
} as const;
export type HeptHostStatusProcessStateEnum = typeof HeptHostStatusProcessStateEnum[keyof typeof HeptHostStatusProcessStateEnum];

/**
 * 
 * @export
 * @interface HeptHostStatusSubjects
 */
export interface HeptHostStatusSubjects {
    /**
     * 
     */
    count: string;
    /**
     * 
     */
    running: string;
}
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
    sentAt?: TimePointRequestInput;
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
    sentAt?: TimePointRequest;
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
 * @interface HeptTaskContinuation
 */
export interface HeptTaskContinuation {
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    goal?: string;
}
/**
 * 
 * @export
 * @interface HeptTaskContinuationInput
 */
export interface HeptTaskContinuationInput {
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    goal?: string;
}
/**
 * 
 * @export
 * @interface HeptTaskRecovery
 */
export interface HeptTaskRecovery {
    /**
     * 
     */
    invocationId?: string;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface HeptTaskRecoveryInput
 */
export interface HeptTaskRecoveryInput {
    /**
     * 
     */
    invocationId?: string;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface HeptTaskRecoveryPlanInput
 */
export interface HeptTaskRecoveryPlanInput {
    /**
     * 
     */
    invocationId?: string;
}
/**
 * 
 * @export
 * @interface HeptTaskRecoveryPlanInputInput
 */
export interface HeptTaskRecoveryPlanInputInput {
    /**
     * 
     */
    invocationId?: string;
}
/**
 * 
 * @export
 * @interface HostDrainRequest
 */
export interface HostDrainRequest {
    /**
     * 
     */
    reason?: string;
}
/**
 * 
 * @export
 * @interface HostStatus
 */
export interface HostStatus {
    /**
     * 
     */
    product: HostStatusProductEnum;
    /**
     * 
     */
    installationId: string;
    /**
     * 
     */
    version: string;
    /**
     * 
     */
    state: HostStatusStateEnum;
    /**
     * 
     */
    components: { [key: string]: HostStatusComponentsValue; };
    /**
     * 
     */
    subjectsAutoStart: boolean;
}


/**
 * @export
 */
export const HostStatusProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type HostStatusProductEnum = typeof HostStatusProductEnum[keyof typeof HostStatusProductEnum];

/**
 * @export
 */
export const HostStatusStateEnum = {
    Created: 'created',
    Starting: 'starting',
    Running: 'running',
    Draining: 'draining',
    Stopped: 'stopped',
    Failed: 'failed',
} as const;
export type HostStatusStateEnum = typeof HostStatusStateEnum[keyof typeof HostStatusStateEnum];

/**
 * 
 * @export
 * @interface HostStatusComponentsValue
 */
export interface HostStatusComponentsValue {
    /**
     * 
     */
    state: HostStatusComponentsValueStateEnum;
    /**
     * 
     */
    code?: string;
    /**
     * 
     */
    problem?: Problem;
}


/**
 * @export
 */
export const HostStatusComponentsValueStateEnum = {
    Available: 'available',
    Degraded: 'degraded',
    Unavailable: 'unavailable',
} as const;
export type HostStatusComponentsValueStateEnum = typeof HostStatusComponentsValueStateEnum[keyof typeof HostStatusComponentsValueStateEnum];

/**
 * 
 * @export
 * @interface HostStatusInput
 */
export interface HostStatusInput {
    /**
     * 
     */
    product: HostStatusInputProductEnum;
    /**
     * 
     */
    installationId: string;
    /**
     * 
     */
    version: string;
    /**
     * 
     */
    state: HostStatusInputStateEnum;
    /**
     * 
     */
    components: { [key: string]: HostStatusInputComponentsValue; };
    /**
     * 
     */
    subjectsAutoStart: boolean;
}


/**
 * @export
 */
export const HostStatusInputProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type HostStatusInputProductEnum = typeof HostStatusInputProductEnum[keyof typeof HostStatusInputProductEnum];

/**
 * @export
 */
export const HostStatusInputStateEnum = {
    Created: 'created',
    Starting: 'starting',
    Running: 'running',
    Draining: 'draining',
    Stopped: 'stopped',
    Failed: 'failed',
} as const;
export type HostStatusInputStateEnum = typeof HostStatusInputStateEnum[keyof typeof HostStatusInputStateEnum];

/**
 * 
 * @export
 * @interface HostStatusInputComponentsValue
 */
export interface HostStatusInputComponentsValue {
    /**
     * 
     */
    state: HostStatusInputComponentsValueStateEnum;
    /**
     * 
     */
    code?: string;
    /**
     * 
     */
    problem?: ProblemInput;
}


/**
 * @export
 */
export const HostStatusInputComponentsValueStateEnum = {
    Available: 'available',
    Degraded: 'degraded',
    Unavailable: 'unavailable',
} as const;
export type HostStatusInputComponentsValueStateEnum = typeof HostStatusInputComponentsValueStateEnum[keyof typeof HostStatusInputComponentsValueStateEnum];

/**
 * 
 * @export
 * @interface HostStop202Response
 */
export interface HostStop202Response {
    /**
     * 
     */
    state: HostStop202ResponseStateEnum;
    /**
     * 
     */
    mode: HostStop202ResponseModeEnum;
}


/**
 * @export
 */
export const HostStop202ResponseStateEnum = {
    Stopping: 'stopping',
} as const;
export type HostStop202ResponseStateEnum = typeof HostStop202ResponseStateEnum[keyof typeof HostStop202ResponseStateEnum];

/**
 * @export
 */
export const HostStop202ResponseModeEnum = {
    Graceful: 'graceful',
    Force: 'force',
} as const;
export type HostStop202ResponseModeEnum = typeof HostStop202ResponseModeEnum[keyof typeof HostStop202ResponseModeEnum];

/**
 * 
 * @export
 * @interface HostStopRequest
 */
export interface HostStopRequest {
    /**
     * 
     */
    mode?: HostStopRequestModeEnum;
}


/**
 * @export
 */
export const HostStopRequestModeEnum = {
    Graceful: 'graceful',
    Force: 'force',
} as const;
export type HostStopRequestModeEnum = typeof HostStopRequestModeEnum[keyof typeof HostStopRequestModeEnum];

/**
 * 
 * @export
 * @interface InputPortion
 */
export interface InputPortion {
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    selector?: Selector;
    /**
     * 
     */
    required: boolean;
}
/**
 * 
 * @export
 * @interface InputPortionInput
 */
export interface InputPortionInput {
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    selector?: SelectorInput;
    /**
     * 
     */
    required?: boolean;
}
/**
 * 
 * @export
 * @interface InvocationSnapshot
 */
export interface InvocationSnapshot {
    /**
     * 
     */
    config: InvocationSnapshotConfig;
    /**
     * 
     */
    roleId: string;
    /**
     * 
     */
    requestedResource: ResourceRef;
    /**
     * 
     */
    actualResource: ResourceRef;
    /**
     * 
     */
    actualProvider: string;
    /**
     * 
     */
    actualModelId: string;
    /**
     * 
     */
    definition: ModelDefinition;
    /**
     * 
     */
    provider?: ProviderDefinition;
    /**
     * 
     */
    policy: RolePolicy;
    /**
     * 
     */
    inference: { [key: string]: JsonValue; };
    /**
     * 
     */
    prompt?: PromptSnapshotRef;
    /**
     * 
     */
    credential?: InvocationSnapshotInputCredential;
    /**
     * 
     */
    network?: InvocationSnapshotNetwork;
    /**
     * 
     */
    pricing?: PriceBook;
    /**
     * 
     */
    budgetAllocation?: BudgetAllocationSnapshot;
}
/**
 * 
 * @export
 * @interface InvocationSnapshotConfig
 */
export interface InvocationSnapshotConfig {
    /**
     * 
     */
    revisions: Array<RevisionRef>;
    /**
     * 
     */
    definitionRevisions: { [key: string]: string; };
    /**
     * 
     */
    digest: string;
}
/**
 * 
 * @export
 * @interface InvocationSnapshotInput
 */
export interface InvocationSnapshotInput {
    /**
     * 
     */
    config: InvocationSnapshotInputConfig;
    /**
     * 
     */
    roleId: string;
    /**
     * 
     */
    requestedResource: ResourceRefInput;
    /**
     * 
     */
    actualResource: ResourceRefInput;
    /**
     * 
     */
    actualProvider: string;
    /**
     * 
     */
    actualModelId: string;
    /**
     * 
     */
    definition: ModelDefinitionInput;
    /**
     * 
     */
    provider?: ProviderDefinitionInput;
    /**
     * 
     */
    policy: RolePolicyInput;
    /**
     * 
     */
    inference: { [key: string]: JsonValueInput; };
    /**
     * 
     */
    prompt?: PromptSnapshotRefInput;
    /**
     * 
     */
    credential?: InvocationSnapshotInputCredential;
    /**
     * 
     */
    network?: InvocationSnapshotInputNetwork;
    /**
     * 
     */
    pricing?: PriceBookInput;
    /**
     * 
     */
    budgetAllocation?: BudgetAllocationSnapshotInput;
}
/**
 * 
 * @export
 * @interface InvocationSnapshotInputConfig
 */
export interface InvocationSnapshotInputConfig {
    /**
     * 
     */
    revisions: Array<RevisionRefInput>;
    /**
     * 
     */
    definitionRevisions: { [key: string]: string; };
    /**
     * 
     */
    digest: string;
}
/**
 * 
 * @export
 * @interface InvocationSnapshotInputCredential
 */
export interface InvocationSnapshotInputCredential {
    /**
     * 
     */
    ref: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    generation: number;
}
/**
 * 
 * @export
 * @interface InvocationSnapshotInputNetwork
 */
export interface InvocationSnapshotInputNetwork {
    /**
     * 
     */
    profileId: string;
    /**
     * 
     */
    revisions: Array<RevisionRefInput>;
}
/**
 * 
 * @export
 * @interface InvocationSnapshotNetwork
 */
export interface InvocationSnapshotNetwork {
    /**
     * 
     */
    profileId: string;
    /**
     * 
     */
    revisions: Array<RevisionRef>;
}
/**
 * 
 * @export
 * @interface Journal
 */
export interface Journal {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: JournalKindEnum;
    /**
     * 
     */
    range: TimeRange;
    /**
     * 
     */
    experienceRefs: Array<Ref>;
    /**
     * 
     */
    perspectiveAt: TimePoint;
    /**
     * 
     */
    mood?: string;
    /**
     * 
     */
    outlook?: string;
}


/**
 * @export
 */
export const JournalKindEnum = {
    Journal: 'Journal',
} as const;
export type JournalKindEnum = typeof JournalKindEnum[keyof typeof JournalKindEnum];

/**
 * 
 * @export
 * @interface JournalInput
 */
export interface JournalInput {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: JournalInputKindEnum;
    /**
     * 
     */
    range: TimeRangeInput;
    /**
     * 
     */
    experienceRefs: Array<RefInput>;
    /**
     * 
     */
    perspectiveAt: TimePointInput;
    /**
     * 
     */
    mood?: string;
    /**
     * 
     */
    outlook?: string;
}


/**
 * @export
 */
export const JournalInputKindEnum = {
    Journal: 'Journal',
} as const;
export type JournalInputKindEnum = typeof JournalInputKindEnum[keyof typeof JournalInputKindEnum];

/**
 * 
 * @export
 * @interface JsonValue
 */
export interface JsonValue {
}
/**
 * 
 * @export
 * @interface JsonValueInput
 */
export interface JsonValueInput {
}
/**
 * @type KnowledgeBody
 * 
 * @export
 */
export type KnowledgeBody = CognitiveSchema | Concept | Episode | Journal | LanguageConvention | Memory | Motivation | Self | Social;
/**
 * @type KnowledgeBodyInput
 * 
 * @export
 */
export type KnowledgeBodyInput = CognitiveSchemaInput | ConceptInput | EpisodeInput | JournalInput | LanguageConventionInput | MemoryInput | MotivationInput | SelfInput | SocialInput;
/**
 * 
 * @export
 * @interface KnowledgeChange
 */
export interface KnowledgeChange {
    /**
     * 
     */
    kind: KnowledgeKind;
    /**
     * 
     */
    body: KnowledgeCreateBody;
    /**
     * 
     */
    sourceRefs: Array<Ref>;
    /**
     * 
     */
    formed: TimePointRequest;
    /**
     * 
     */
    valid?: TimeRangeRequest;
    /**
     * 
     */
    formation: KnowledgeChangeFormationEnum;
    /**
     * 
     */
    stance: KnowledgeChangeStanceEnum;
    /**
     * 
     */
    confidence: number;
    /**
     * 
     */
    policy?: Policy;
    /**
     * 
     */
    target?: KnowledgeChangeTarget;
    /**
     * 
     */
    reason: string;
}


/**
 * @export
 */
export const KnowledgeChangeFormationEnum = {
    Observed: 'observed',
    Told: 'told',
    Read: 'read',
    Inferred: 'inferred',
    Reflection: 'reflection',
    InitialSetting: 'initial_setting',
    OperatorEdit: 'operator_edit',
} as const;
export type KnowledgeChangeFormationEnum = typeof KnowledgeChangeFormationEnum[keyof typeof KnowledgeChangeFormationEnum];

/**
 * @export
 */
export const KnowledgeChangeStanceEnum = {
    Accepted: 'accepted',
    Uncertain: 'uncertain',
    Hypothesis: 'hypothesis',
    Disputed: 'disputed',
} as const;
export type KnowledgeChangeStanceEnum = typeof KnowledgeChangeStanceEnum[keyof typeof KnowledgeChangeStanceEnum];

/**
 * 
 * @export
 * @interface KnowledgeChangeInput
 */
export interface KnowledgeChangeInput {
    /**
     * 
     */
    kind: KnowledgeKindInput;
    /**
     * 
     */
    body: KnowledgeCreateInputBody;
    /**
     * 
     */
    sourceRefs: Array<RefInput>;
    /**
     * 
     */
    formed: TimePointRequestInput;
    /**
     * 
     */
    valid?: TimeRangeRequestInput;
    /**
     * 
     */
    formation: KnowledgeChangeInputFormationEnum;
    /**
     * 
     */
    stance: KnowledgeChangeInputStanceEnum;
    /**
     * 
     */
    confidence?: number;
    /**
     * 
     */
    policy?: PolicyInput;
    /**
     * 
     */
    target?: KnowledgeChangeInputTarget;
    /**
     * 
     */
    reason: string;
}


/**
 * @export
 */
export const KnowledgeChangeInputFormationEnum = {
    Observed: 'observed',
    Told: 'told',
    Read: 'read',
    Inferred: 'inferred',
    Reflection: 'reflection',
    InitialSetting: 'initial_setting',
    OperatorEdit: 'operator_edit',
} as const;
export type KnowledgeChangeInputFormationEnum = typeof KnowledgeChangeInputFormationEnum[keyof typeof KnowledgeChangeInputFormationEnum];

/**
 * @export
 */
export const KnowledgeChangeInputStanceEnum = {
    Accepted: 'accepted',
    Uncertain: 'uncertain',
    Hypothesis: 'hypothesis',
    Disputed: 'disputed',
} as const;
export type KnowledgeChangeInputStanceEnum = typeof KnowledgeChangeInputStanceEnum[keyof typeof KnowledgeChangeInputStanceEnum];

/**
 * 
 * @export
 * @interface KnowledgeChangeInputTarget
 */
export interface KnowledgeChangeInputTarget {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface KnowledgeChangeTarget
 */
export interface KnowledgeChangeTarget {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface KnowledgeCreate
 */
export interface KnowledgeCreate {
    /**
     * 
     */
    kind: KnowledgeKind;
    /**
     * 
     */
    body: KnowledgeCreateBody;
    /**
     * 
     */
    sourceRefs: Array<Ref>;
    /**
     * 
     */
    formed: TimePointRequest;
    /**
     * 
     */
    valid?: TimeRangeRequest;
    /**
     * 
     */
    formation: KnowledgeCreateFormationEnum;
    /**
     * 
     */
    stance: KnowledgeCreateStanceEnum;
    /**
     * 
     */
    confidence: number;
    /**
     * 
     */
    policy?: Policy;
}


/**
 * @export
 */
export const KnowledgeCreateFormationEnum = {
    Observed: 'observed',
    Told: 'told',
    Read: 'read',
    Inferred: 'inferred',
    Reflection: 'reflection',
    InitialSetting: 'initial_setting',
    OperatorEdit: 'operator_edit',
} as const;
export type KnowledgeCreateFormationEnum = typeof KnowledgeCreateFormationEnum[keyof typeof KnowledgeCreateFormationEnum];

/**
 * @export
 */
export const KnowledgeCreateStanceEnum = {
    Accepted: 'accepted',
    Uncertain: 'uncertain',
    Hypothesis: 'hypothesis',
    Disputed: 'disputed',
} as const;
export type KnowledgeCreateStanceEnum = typeof KnowledgeCreateStanceEnum[keyof typeof KnowledgeCreateStanceEnum];

/**
 * @type KnowledgeCreateBody
 * 
 * @export
 */
export type KnowledgeCreateBody = CognitiveSchema | Concept | KnowledgeCreateBodyOneOf | KnowledgeCreateBodyOneOf1 | KnowledgeCreateBodyOneOf2 | LanguageConvention | Memory | Self | Social;
/**
 * 
 * @export
 * @interface KnowledgeCreateBodyOneOf
 */
export interface KnowledgeCreateBodyOneOf {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: KnowledgeCreateBodyOneOfKindEnum;
    /**
     * 
     */
    track: KnowledgeCreateBodyOneOfTrackEnum;
    /**
     * 
     */
    range: TimeRangeRequest;
    /**
     * 
     */
    members: Array<Ref>;
    /**
     * 
     */
    participants: Array<Ref>;
    /**
     * 
     */
    placeRef?: Ref;
    /**
     * 
     */
    parentRef?: Ref;
}


/**
 * @export
 */
export const KnowledgeCreateBodyOneOfKindEnum = {
    Episode: 'Episode',
} as const;
export type KnowledgeCreateBodyOneOfKindEnum = typeof KnowledgeCreateBodyOneOfKindEnum[keyof typeof KnowledgeCreateBodyOneOfKindEnum];

/**
 * @export
 */
export const KnowledgeCreateBodyOneOfTrackEnum = {
    Life: 'life',
    Social: 'social',
    Work: 'work',
} as const;
export type KnowledgeCreateBodyOneOfTrackEnum = typeof KnowledgeCreateBodyOneOfTrackEnum[keyof typeof KnowledgeCreateBodyOneOfTrackEnum];

/**
 * 
 * @export
 * @interface KnowledgeCreateBodyOneOf1
 */
export interface KnowledgeCreateBodyOneOf1 {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: KnowledgeCreateBodyOneOf1KindEnum;
    /**
     * 
     */
    range: TimeRangeRequest;
    /**
     * 
     */
    experienceRefs: Array<Ref>;
    /**
     * 
     */
    perspectiveAt: TimePointRequest;
    /**
     * 
     */
    mood?: string;
    /**
     * 
     */
    outlook?: string;
}


/**
 * @export
 */
export const KnowledgeCreateBodyOneOf1KindEnum = {
    Journal: 'Journal',
} as const;
export type KnowledgeCreateBodyOneOf1KindEnum = typeof KnowledgeCreateBodyOneOf1KindEnum[keyof typeof KnowledgeCreateBodyOneOf1KindEnum];

/**
 * 
 * @export
 * @interface KnowledgeCreateBodyOneOf2
 */
export interface KnowledgeCreateBodyOneOf2 {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: KnowledgeCreateBodyOneOf2KindEnum;
    /**
     * 
     */
    aspect: KnowledgeCreateBodyOneOf2AspectEnum;
    /**
     * 
     */
    importance: number;
    /**
     * 
     */
    criterion?: KnowledgeCreateBodyOneOf2Criterion;
}


/**
 * @export
 */
export const KnowledgeCreateBodyOneOf2KindEnum = {
    Motivation: 'Motivation',
} as const;
export type KnowledgeCreateBodyOneOf2KindEnum = typeof KnowledgeCreateBodyOneOf2KindEnum[keyof typeof KnowledgeCreateBodyOneOf2KindEnum];

/**
 * @export
 */
export const KnowledgeCreateBodyOneOf2AspectEnum = {
    Desire: 'desire',
    Concern: 'concern',
    EvaluableExpectation: 'evaluable_expectation',
} as const;
export type KnowledgeCreateBodyOneOf2AspectEnum = typeof KnowledgeCreateBodyOneOf2AspectEnum[keyof typeof KnowledgeCreateBodyOneOf2AspectEnum];

/**
 * 
 * @export
 * @interface KnowledgeCreateBodyOneOf2Criterion
 */
export interface KnowledgeCreateBodyOneOf2Criterion {
    /**
     * 
     */
    mode: KnowledgeCreateBodyOneOf2CriterionModeEnum;
    /**
     * 
     */
    range: TimeRangeRequest;
    /**
     * 
     */
    condition: string;
    /**
     * 
     */
    predicate?: CriterionPredicate;
    /**
     * 
     */
    requiredCoverage: number;
}


/**
 * @export
 */
export const KnowledgeCreateBodyOneOf2CriterionModeEnum = {
    Achieve: 'achieve',
    Terminate: 'terminate',
    Maintain: 'maintain',
    Avoid: 'avoid',
} as const;
export type KnowledgeCreateBodyOneOf2CriterionModeEnum = typeof KnowledgeCreateBodyOneOf2CriterionModeEnum[keyof typeof KnowledgeCreateBodyOneOf2CriterionModeEnum];

/**
 * 
 * @export
 * @interface KnowledgeCreateInput
 */
export interface KnowledgeCreateInput {
    /**
     * 
     */
    kind: KnowledgeKindInput;
    /**
     * 
     */
    body: KnowledgeCreateInputBody;
    /**
     * 
     */
    sourceRefs: Array<RefInput>;
    /**
     * 
     */
    formed: TimePointRequestInput;
    /**
     * 
     */
    valid?: TimeRangeRequestInput;
    /**
     * 
     */
    formation: KnowledgeCreateInputFormationEnum;
    /**
     * 
     */
    stance: KnowledgeCreateInputStanceEnum;
    /**
     * 
     */
    confidence?: number;
    /**
     * 
     */
    policy?: PolicyInput;
}


/**
 * @export
 */
export const KnowledgeCreateInputFormationEnum = {
    Observed: 'observed',
    Told: 'told',
    Read: 'read',
    Inferred: 'inferred',
    Reflection: 'reflection',
    InitialSetting: 'initial_setting',
    OperatorEdit: 'operator_edit',
} as const;
export type KnowledgeCreateInputFormationEnum = typeof KnowledgeCreateInputFormationEnum[keyof typeof KnowledgeCreateInputFormationEnum];

/**
 * @export
 */
export const KnowledgeCreateInputStanceEnum = {
    Accepted: 'accepted',
    Uncertain: 'uncertain',
    Hypothesis: 'hypothesis',
    Disputed: 'disputed',
} as const;
export type KnowledgeCreateInputStanceEnum = typeof KnowledgeCreateInputStanceEnum[keyof typeof KnowledgeCreateInputStanceEnum];

/**
 * @type KnowledgeCreateInputBody
 * 
 * @export
 */
export type KnowledgeCreateInputBody = CognitiveSchemaInput | ConceptInput | KnowledgeCreateInputBodyOneOf | KnowledgeCreateInputBodyOneOf1 | KnowledgeCreateInputBodyOneOf2 | LanguageConventionInput | MemoryInput | SelfInput | SocialInput;
/**
 * 
 * @export
 * @interface KnowledgeCreateInputBodyOneOf
 */
export interface KnowledgeCreateInputBodyOneOf {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: KnowledgeCreateInputBodyOneOfKindEnum;
    /**
     * 
     */
    track: KnowledgeCreateInputBodyOneOfTrackEnum;
    /**
     * 
     */
    range: TimeRangeRequestInput;
    /**
     * 
     */
    members: Array<RefInput>;
    /**
     * 
     */
    participants?: Array<RefInput>;
    /**
     * 
     */
    placeRef?: RefInput;
    /**
     * 
     */
    parentRef?: RefInput;
}


/**
 * @export
 */
export const KnowledgeCreateInputBodyOneOfKindEnum = {
    Episode: 'Episode',
} as const;
export type KnowledgeCreateInputBodyOneOfKindEnum = typeof KnowledgeCreateInputBodyOneOfKindEnum[keyof typeof KnowledgeCreateInputBodyOneOfKindEnum];

/**
 * @export
 */
export const KnowledgeCreateInputBodyOneOfTrackEnum = {
    Life: 'life',
    Social: 'social',
    Work: 'work',
} as const;
export type KnowledgeCreateInputBodyOneOfTrackEnum = typeof KnowledgeCreateInputBodyOneOfTrackEnum[keyof typeof KnowledgeCreateInputBodyOneOfTrackEnum];

/**
 * 
 * @export
 * @interface KnowledgeCreateInputBodyOneOf1
 */
export interface KnowledgeCreateInputBodyOneOf1 {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: KnowledgeCreateInputBodyOneOf1KindEnum;
    /**
     * 
     */
    range: TimeRangeRequestInput;
    /**
     * 
     */
    experienceRefs: Array<RefInput>;
    /**
     * 
     */
    perspectiveAt: TimePointRequestInput;
    /**
     * 
     */
    mood?: string;
    /**
     * 
     */
    outlook?: string;
}


/**
 * @export
 */
export const KnowledgeCreateInputBodyOneOf1KindEnum = {
    Journal: 'Journal',
} as const;
export type KnowledgeCreateInputBodyOneOf1KindEnum = typeof KnowledgeCreateInputBodyOneOf1KindEnum[keyof typeof KnowledgeCreateInputBodyOneOf1KindEnum];

/**
 * 
 * @export
 * @interface KnowledgeCreateInputBodyOneOf2
 */
export interface KnowledgeCreateInputBodyOneOf2 {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: KnowledgeCreateInputBodyOneOf2KindEnum;
    /**
     * 
     */
    aspect: KnowledgeCreateInputBodyOneOf2AspectEnum;
    /**
     * 
     */
    importance: number;
    /**
     * 
     */
    criterion?: KnowledgeCreateInputBodyOneOf2Criterion;
}


/**
 * @export
 */
export const KnowledgeCreateInputBodyOneOf2KindEnum = {
    Motivation: 'Motivation',
} as const;
export type KnowledgeCreateInputBodyOneOf2KindEnum = typeof KnowledgeCreateInputBodyOneOf2KindEnum[keyof typeof KnowledgeCreateInputBodyOneOf2KindEnum];

/**
 * @export
 */
export const KnowledgeCreateInputBodyOneOf2AspectEnum = {
    Desire: 'desire',
    Concern: 'concern',
    EvaluableExpectation: 'evaluable_expectation',
} as const;
export type KnowledgeCreateInputBodyOneOf2AspectEnum = typeof KnowledgeCreateInputBodyOneOf2AspectEnum[keyof typeof KnowledgeCreateInputBodyOneOf2AspectEnum];

/**
 * 
 * @export
 * @interface KnowledgeCreateInputBodyOneOf2Criterion
 */
export interface KnowledgeCreateInputBodyOneOf2Criterion {
    /**
     * 
     */
    mode: KnowledgeCreateInputBodyOneOf2CriterionModeEnum;
    /**
     * 
     */
    range: TimeRangeRequestInput;
    /**
     * 
     */
    condition: string;
    /**
     * 
     */
    predicate?: CriterionInputPredicate;
    /**
     * 
     */
    requiredCoverage?: number;
}


/**
 * @export
 */
export const KnowledgeCreateInputBodyOneOf2CriterionModeEnum = {
    Achieve: 'achieve',
    Terminate: 'terminate',
    Maintain: 'maintain',
    Avoid: 'avoid',
} as const;
export type KnowledgeCreateInputBodyOneOf2CriterionModeEnum = typeof KnowledgeCreateInputBodyOneOf2CriterionModeEnum[keyof typeof KnowledgeCreateInputBodyOneOf2CriterionModeEnum];

/**
 * 
 * @export
 * @interface KnowledgeHistory
 */
export interface KnowledgeHistory {
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit: number;
    /**
     * 
     */
    knowledgeAt?: TimePointRequest;
    /**
     * 
     */
    recordedAsOf?: any;
}
/**
 * 
 * @export
 * @interface KnowledgeHistoryInput
 */
export interface KnowledgeHistoryInput {
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
    /**
     * 
     */
    knowledgeAt?: TimePointRequestInput;
    /**
     * 
     */
    recordedAsOf?: string;
}

/**
 * 
 * @export
 */
export const KnowledgeKind = {
    Memory: 'Memory',
    Episode: 'Episode',
    Journal: 'Journal',
    Schema: 'Schema',
    Concept: 'Concept',
    Self: 'Self',
    Social: 'Social',
    LanguageConvention: 'LanguageConvention',
    Motivation: 'Motivation',
} as const;
export type KnowledgeKind = typeof KnowledgeKind[keyof typeof KnowledgeKind];


/**
 * 
 * @export
 */
export const KnowledgeKindInput = {
    Memory: 'Memory',
    Episode: 'Episode',
    Journal: 'Journal',
    Schema: 'Schema',
    Concept: 'Concept',
    Self: 'Self',
    Social: 'Social',
    LanguageConvention: 'LanguageConvention',
    Motivation: 'Motivation',
} as const;
export type KnowledgeKindInput = typeof KnowledgeKindInput[keyof typeof KnowledgeKindInput];

/**
 * 
 * @export
 * @interface KnowledgeList
 */
export interface KnowledgeList {
    /**
     * 
     */
    kinds?: Array<KnowledgeKind>;
    /**
     * 
     */
    knowledgeAt?: TimePointRequest;
    /**
     * 
     */
    recordedAsOf?: any;
    /**
     * 
     */
    includeInactive?: boolean;
    /**
     * 
     */
    includeHistory?: boolean;
    /**
     * 
     */
    range?: TimeRangeRequest;
    /**
     * 
     */
    ids?: Array<string>;
    /**
     * 
     */
    entities?: Array<string>;
    /**
     * 
     */
    entityMatch?: KnowledgeListEntityMatchEnum;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    tagMatch?: KnowledgeListTagMatchEnum;
    /**
     * 
     */
    refs?: Array<string>;
    /**
     * 
     */
    sources?: Array<string>;
    /**
     * 
     */
    conceptIds?: Array<string>;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit: number;
}


/**
 * @export
 */
export const KnowledgeListEntityMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type KnowledgeListEntityMatchEnum = typeof KnowledgeListEntityMatchEnum[keyof typeof KnowledgeListEntityMatchEnum];

/**
 * @export
 */
export const KnowledgeListTagMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type KnowledgeListTagMatchEnum = typeof KnowledgeListTagMatchEnum[keyof typeof KnowledgeListTagMatchEnum];

/**
 * 
 * @export
 * @interface KnowledgeListInput
 */
export interface KnowledgeListInput {
    /**
     * 
     */
    kinds?: Array<KnowledgeKindInput>;
    /**
     * 
     */
    knowledgeAt?: TimePointRequestInput;
    /**
     * 
     */
    recordedAsOf?: string;
    /**
     * 
     */
    includeInactive?: boolean;
    /**
     * 
     */
    includeHistory?: boolean;
    /**
     * 
     */
    range?: TimeRangeRequestInput;
    /**
     * 
     */
    ids?: Array<string>;
    /**
     * 
     */
    entities?: Array<string>;
    /**
     * 
     */
    entityMatch?: KnowledgeListInputEntityMatchEnum;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    tagMatch?: KnowledgeListInputTagMatchEnum;
    /**
     * 
     */
    refs?: Array<string>;
    /**
     * 
     */
    sources?: Array<string>;
    /**
     * 
     */
    conceptIds?: Array<string>;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
}


/**
 * @export
 */
export const KnowledgeListInputEntityMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type KnowledgeListInputEntityMatchEnum = typeof KnowledgeListInputEntityMatchEnum[keyof typeof KnowledgeListInputEntityMatchEnum];

/**
 * @export
 */
export const KnowledgeListInputTagMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type KnowledgeListInputTagMatchEnum = typeof KnowledgeListInputTagMatchEnum[keyof typeof KnowledgeListInputTagMatchEnum];

/**
 * 
 * @export
 * @interface KnowledgePage
 */
export interface KnowledgePage {
    /**
     * 
     */
    items: Array<KnowledgeView>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface KnowledgePageInput
 */
export interface KnowledgePageInput {
    /**
     * 
     */
    items: Array<KnowledgeViewInput>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface KnowledgeRead
 */
export interface KnowledgeRead {
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
    knowledgeAt?: TimePointRequest;
    /**
     * 
     */
    recordedAsOf?: any;
}
/**
 * 
 * @export
 * @interface KnowledgeReadInput
 */
export interface KnowledgeReadInput {
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
    knowledgeAt?: TimePointRequestInput;
    /**
     * 
     */
    recordedAsOf?: string;
}
/**
 * 
 * @export
 * @interface KnowledgeRevise
 */
export interface KnowledgeRevise {
    /**
     * 
     */
    kind: KnowledgeKind;
    /**
     * 
     */
    body: KnowledgeCreateBody;
    /**
     * 
     */
    sourceRefs: Array<Ref>;
    /**
     * 
     */
    formed: TimePointRequest;
    /**
     * 
     */
    valid?: TimeRangeRequest;
    /**
     * 
     */
    formation: KnowledgeReviseFormationEnum;
    /**
     * 
     */
    stance: KnowledgeReviseStanceEnum;
    /**
     * 
     */
    confidence: number;
    /**
     * 
     */
    policy?: Policy;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    reason: string;
}


/**
 * @export
 */
export const KnowledgeReviseFormationEnum = {
    Observed: 'observed',
    Told: 'told',
    Read: 'read',
    Inferred: 'inferred',
    Reflection: 'reflection',
    InitialSetting: 'initial_setting',
    OperatorEdit: 'operator_edit',
} as const;
export type KnowledgeReviseFormationEnum = typeof KnowledgeReviseFormationEnum[keyof typeof KnowledgeReviseFormationEnum];

/**
 * @export
 */
export const KnowledgeReviseStanceEnum = {
    Accepted: 'accepted',
    Uncertain: 'uncertain',
    Hypothesis: 'hypothesis',
    Disputed: 'disputed',
} as const;
export type KnowledgeReviseStanceEnum = typeof KnowledgeReviseStanceEnum[keyof typeof KnowledgeReviseStanceEnum];

/**
 * 
 * @export
 * @interface KnowledgeReviseInput
 */
export interface KnowledgeReviseInput {
    /**
     * 
     */
    kind: KnowledgeKindInput;
    /**
     * 
     */
    body: KnowledgeCreateInputBody;
    /**
     * 
     */
    sourceRefs: Array<RefInput>;
    /**
     * 
     */
    formed: TimePointRequestInput;
    /**
     * 
     */
    valid?: TimeRangeRequestInput;
    /**
     * 
     */
    formation: KnowledgeReviseInputFormationEnum;
    /**
     * 
     */
    stance: KnowledgeReviseInputStanceEnum;
    /**
     * 
     */
    confidence?: number;
    /**
     * 
     */
    policy?: PolicyInput;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    reason: string;
}


/**
 * @export
 */
export const KnowledgeReviseInputFormationEnum = {
    Observed: 'observed',
    Told: 'told',
    Read: 'read',
    Inferred: 'inferred',
    Reflection: 'reflection',
    InitialSetting: 'initial_setting',
    OperatorEdit: 'operator_edit',
} as const;
export type KnowledgeReviseInputFormationEnum = typeof KnowledgeReviseInputFormationEnum[keyof typeof KnowledgeReviseInputFormationEnum];

/**
 * @export
 */
export const KnowledgeReviseInputStanceEnum = {
    Accepted: 'accepted',
    Uncertain: 'uncertain',
    Hypothesis: 'hypothesis',
    Disputed: 'disputed',
} as const;
export type KnowledgeReviseInputStanceEnum = typeof KnowledgeReviseInputStanceEnum[keyof typeof KnowledgeReviseInputStanceEnum];

/**
 * 
 * @export
 * @interface KnowledgeView
 */
export interface KnowledgeView {
    /**
     * 
     */
    kind: KnowledgeKind;
    /**
     * 
     */
    body: KnowledgeBody;
    /**
     * 
     */
    sourceRefs: Array<Ref>;
    /**
     * 
     */
    formed: TimePoint;
    /**
     * 
     */
    valid?: TimeRange;
    /**
     * 
     */
    formation: KnowledgeViewFormationEnum;
    /**
     * 
     */
    stance: KnowledgeViewStanceEnum;
    /**
     * 
     */
    confidence: number;
    /**
     * 
     */
    policy: Policy;
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    alias: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    sourceRoots: Array<Ref>;
    /**
     * 
     */
    recorded: TimePoint;
    /**
     * 
     */
    status: KnowledgeViewStatusEnum;
}


/**
 * @export
 */
export const KnowledgeViewFormationEnum = {
    Observed: 'observed',
    Told: 'told',
    Read: 'read',
    Inferred: 'inferred',
    Reflection: 'reflection',
    InitialSetting: 'initial_setting',
    OperatorEdit: 'operator_edit',
} as const;
export type KnowledgeViewFormationEnum = typeof KnowledgeViewFormationEnum[keyof typeof KnowledgeViewFormationEnum];

/**
 * @export
 */
export const KnowledgeViewStanceEnum = {
    Accepted: 'accepted',
    Uncertain: 'uncertain',
    Hypothesis: 'hypothesis',
    Disputed: 'disputed',
} as const;
export type KnowledgeViewStanceEnum = typeof KnowledgeViewStanceEnum[keyof typeof KnowledgeViewStanceEnum];

/**
 * @export
 */
export const KnowledgeViewStatusEnum = {
    Active: 'active',
    Suppressed: 'suppressed',
    Retired: 'retired',
    Purged: 'purged',
} as const;
export type KnowledgeViewStatusEnum = typeof KnowledgeViewStatusEnum[keyof typeof KnowledgeViewStatusEnum];

/**
 * 
 * @export
 * @interface KnowledgeViewInput
 */
export interface KnowledgeViewInput {
    /**
     * 
     */
    kind: KnowledgeKindInput;
    /**
     * 
     */
    body: KnowledgeBodyInput;
    /**
     * 
     */
    sourceRefs: Array<RefInput>;
    /**
     * 
     */
    formed: TimePointInput;
    /**
     * 
     */
    valid?: TimeRangeInput;
    /**
     * 
     */
    formation: KnowledgeViewInputFormationEnum;
    /**
     * 
     */
    stance: KnowledgeViewInputStanceEnum;
    /**
     * 
     */
    confidence?: number;
    /**
     * 
     */
    policy: PolicyInput;
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    alias: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    sourceRoots: Array<RefInput>;
    /**
     * 
     */
    recorded: TimePointInput;
    /**
     * 
     */
    status: KnowledgeViewInputStatusEnum;
}


/**
 * @export
 */
export const KnowledgeViewInputFormationEnum = {
    Observed: 'observed',
    Told: 'told',
    Read: 'read',
    Inferred: 'inferred',
    Reflection: 'reflection',
    InitialSetting: 'initial_setting',
    OperatorEdit: 'operator_edit',
} as const;
export type KnowledgeViewInputFormationEnum = typeof KnowledgeViewInputFormationEnum[keyof typeof KnowledgeViewInputFormationEnum];

/**
 * @export
 */
export const KnowledgeViewInputStanceEnum = {
    Accepted: 'accepted',
    Uncertain: 'uncertain',
    Hypothesis: 'hypothesis',
    Disputed: 'disputed',
} as const;
export type KnowledgeViewInputStanceEnum = typeof KnowledgeViewInputStanceEnum[keyof typeof KnowledgeViewInputStanceEnum];

/**
 * @export
 */
export const KnowledgeViewInputStatusEnum = {
    Active: 'active',
    Suppressed: 'suppressed',
    Retired: 'retired',
    Purged: 'purged',
} as const;
export type KnowledgeViewInputStatusEnum = typeof KnowledgeViewInputStatusEnum[keyof typeof KnowledgeViewInputStatusEnum];

/**
 * 
 * @export
 * @interface LanguageConvention
 */
export interface LanguageConvention {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: LanguageConventionKindEnum;
    /**
     * 
     */
    form: string;
    /**
     * 
     */
    meaning: string;
    /**
     * 
     */
    usage: string;
    /**
     * 
     */
    scopeRefs: Array<Ref>;
    /**
     * 
     */
    examples: Array<string>;
}


/**
 * @export
 */
export const LanguageConventionKindEnum = {
    LanguageConvention: 'LanguageConvention',
} as const;
export type LanguageConventionKindEnum = typeof LanguageConventionKindEnum[keyof typeof LanguageConventionKindEnum];

/**
 * 
 * @export
 * @interface LanguageConventionInput
 */
export interface LanguageConventionInput {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: LanguageConventionInputKindEnum;
    /**
     * 
     */
    form: string;
    /**
     * 
     */
    meaning: string;
    /**
     * 
     */
    usage: string;
    /**
     * 
     */
    scopeRefs: Array<RefInput>;
    /**
     * 
     */
    examples: Array<string>;
}


/**
 * @export
 */
export const LanguageConventionInputKindEnum = {
    LanguageConvention: 'LanguageConvention',
} as const;
export type LanguageConventionInputKindEnum = typeof LanguageConventionInputKindEnum[keyof typeof LanguageConventionInputKindEnum];

/**
 * 
 * @export
 * @interface LanguageSettings
 */
export interface LanguageSettings {
    /**
     * 
     */
    maxOutputTokens: number;
    /**
     * 
     */
    temperature?: number;
    /**
     * 
     */
    reasoning?: Reasoning;
    /**
     * 
     */
    providerOptions: { [key: string]: { [key: string]: JsonValue; }; };
}


/**
 * 
 * @export
 * @interface LanguageSettingsInput
 */
export interface LanguageSettingsInput {
    /**
     * 
     */
    maxOutputTokens: number;
    /**
     * 
     */
    temperature?: number;
    /**
     * 
     */
    reasoning?: ReasoningInput;
    /**
     * 
     */
    providerOptions: { [key: string]: { [key: string]: JsonValueInput; }; };
}


/**
 * 
 * @export
 * @interface MaterialCapture
 */
export interface MaterialCapture {
    /**
     * 
     */
    kind: string;
    /**
     * 
     */
    mediaType: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    text?: string;
    /**
     * 
     */
    blobRef?: Ref;
    /**
     * 
     */
    source: MaterialSource;
    /**
     * 
     */
    occurred?: TimeRangeRequest;
    /**
     * 
     */
    policy?: Policy;
}
/**
 * 
 * @export
 * @interface MaterialCaptureInput
 */
export interface MaterialCaptureInput {
    /**
     * 
     */
    kind: string;
    /**
     * 
     */
    mediaType: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    text?: string;
    /**
     * 
     */
    blobRef?: RefInput;
    /**
     * 
     */
    source: MaterialSourceInput;
    /**
     * 
     */
    occurred?: TimeRangeRequestInput;
    /**
     * 
     */
    policy?: PolicyInput;
}
/**
 * 
 * @export
 * @interface MaterialPublish
 */
export interface MaterialPublish {
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    title?: string;
}
/**
 * 
 * @export
 * @interface MaterialPublishInput
 */
export interface MaterialPublishInput {
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    title?: string;
}
/**
 * 
 * @export
 * @interface MaterialSource
 */
export interface MaterialSource {
    /**
     * 
     */
    ref?: Ref;
    /**
     * 
     */
    inputs: Array<Ref>;
    /**
     * 
     */
    roots: Array<Ref>;
    /**
     * 
     */
    originVersion?: string;
}
/**
 * 
 * @export
 * @interface MaterialSourceInput
 */
export interface MaterialSourceInput {
    /**
     * 
     */
    ref?: RefInput;
    /**
     * 
     */
    inputs?: Array<RefInput>;
    /**
     * 
     */
    roots?: Array<RefInput>;
    /**
     * 
     */
    originVersion?: string;
}
/**
 * 
 * @export
 * @interface MaterialView
 */
export interface MaterialView {
    /**
     * 
     */
    kind: string;
    /**
     * 
     */
    mediaType: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    text?: string;
    /**
     * 
     */
    blobRef?: Ref;
    /**
     * 
     */
    source: MaterialSource;
    /**
     * 
     */
    occurred?: TimeRange;
    /**
     * 
     */
    policy: Policy;
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    scope: Consumer;
    /**
     * 
     */
    recordedAt: string;
}
/**
 * 
 * @export
 * @interface MaterialViewInput
 */
export interface MaterialViewInput {
    /**
     * 
     */
    kind: string;
    /**
     * 
     */
    mediaType: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    text?: string;
    /**
     * 
     */
    blobRef?: RefInput;
    /**
     * 
     */
    source: MaterialSourceInput;
    /**
     * 
     */
    occurred?: TimeRangeInput;
    /**
     * 
     */
    policy: PolicyInput;
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    scope: ConsumerInput;
    /**
     * 
     */
    recordedAt: string;
}
/**
 * 
 * @export
 * @interface MediaCaptureQuery
 */
export interface MediaCaptureQuery {
    /**
     * 
     */
    channelAccount?: string;
    /**
     * 
     */
    conversationKey?: string;
}
/**
 * 
 * @export
 * @interface MediaCaptureQueryInput
 */
export interface MediaCaptureQueryInput {
    /**
     * 
     */
    channelAccount?: string;
    /**
     * 
     */
    conversationKey?: string;
}
/**
 * 
 * @export
 * @interface MediaCaptureResult
 */
export interface MediaCaptureResult {
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    bytes: number;
    /**
     * 
     */
    mediaType: string;
    /**
     * 
     */
    name: string;
}
/**
 * 
 * @export
 * @interface MediaCaptureResultInput
 */
export interface MediaCaptureResultInput {
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    bytes: number;
    /**
     * 
     */
    mediaType: string;
    /**
     * 
     */
    name: string;
}
/**
 * 
 * @export
 * @interface MediaCaptureSource
 */
export interface MediaCaptureSource {
    /**
     * 
     */
    channelAccount: string;
    /**
     * 
     */
    conversationKey: string;
}
/**
 * 
 * @export
 * @interface MediaCaptureSourceInput
 */
export interface MediaCaptureSourceInput {
    /**
     * 
     */
    channelAccount: string;
    /**
     * 
     */
    conversationKey: string;
}
/**
 * 
 * @export
 * @interface Memory
 */
export interface Memory {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: MemoryKindEnum;
    /**
     * 
     */
    role: MemoryRoleEnum;
}


/**
 * @export
 */
export const MemoryKindEnum = {
    Memory: 'Memory',
} as const;
export type MemoryKindEnum = typeof MemoryKindEnum[keyof typeof MemoryKindEnum];

/**
 * @export
 */
export const MemoryRoleEnum = {
    Experience: 'experience',
    Fact: 'fact',
    Reported: 'reported',
    Preference: 'preference',
    Procedure: 'procedure',
    Interpretation: 'interpretation',
} as const;
export type MemoryRoleEnum = typeof MemoryRoleEnum[keyof typeof MemoryRoleEnum];

/**
 * 
 * @export
 * @interface MemoryInput
 */
export interface MemoryInput {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: MemoryInputKindEnum;
    /**
     * 
     */
    role?: MemoryInputRoleEnum;
}


/**
 * @export
 */
export const MemoryInputKindEnum = {
    Memory: 'Memory',
} as const;
export type MemoryInputKindEnum = typeof MemoryInputKindEnum[keyof typeof MemoryInputKindEnum];

/**
 * @export
 */
export const MemoryInputRoleEnum = {
    Experience: 'experience',
    Fact: 'fact',
    Reported: 'reported',
    Preference: 'preference',
    Procedure: 'procedure',
    Interpretation: 'interpretation',
} as const;
export type MemoryInputRoleEnum = typeof MemoryInputRoleEnum[keyof typeof MemoryInputRoleEnum];

/**
 * 
 * @export
 * @interface MessagesChangeRequest
 */
export interface MessagesChangeRequest {
    /**
     * 
     */
    messageId?: string;
    /**
     * 
     */
    source?: MessagesChangeRequestSource;
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
    expectedRevision?: number;
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
 * @interface MessagesChangeRequestSource
 */
export interface MessagesChangeRequestSource {
    /**
     * 
     */
    channelAccount: string;
    /**
     * 
     */
    conversationKey: string;
    /**
     * 
     */
    platformMessageId: string;
}
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
    sentAt?: TimePointRequestInput;
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
    dueAt?: TimePointRequestInput;
}
/**
 * 
 * @export
 * @interface MessagesUpdatePolicyRequest
 */
export interface MessagesUpdatePolicyRequest {
    /**
     * 
     */
    policy: PolicyInput;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface ModelBudget
 */
export interface ModelBudget {
    /**
     * 
     */
    maxCalls?: number;
    /**
     * 
     */
    maxTokens?: number;
    /**
     * 
     */
    concurrentCalls?: number;
    /**
     * 
     */
    totalAmount?: Money | null;
    /**
     * 
     */
    dailyAmount?: Money | null;
    /**
     * 
     */
    perCallAmount?: Money | null;
    /**
     * 
     */
    window?: ModelBudgetInputWindow;
    /**
     * 
     */
    timeZone?: string;
}
/**
 * 
 * @export
 * @interface ModelBudgetInput
 */
export interface ModelBudgetInput {
    /**
     * 
     */
    maxCalls?: number;
    /**
     * 
     */
    maxTokens?: number;
    /**
     * 
     */
    concurrentCalls?: number;
    /**
     * 
     */
    totalAmount?: MoneyInput | null;
    /**
     * 
     */
    dailyAmount?: MoneyInput | null;
    /**
     * 
     */
    perCallAmount?: MoneyInput | null;
    /**
     * 
     */
    window?: ModelBudgetInputWindow;
    /**
     * 
     */
    timeZone?: string;
}
/**
 * 
 * @export
 * @interface ModelBudgetInputWindow
 */
export interface ModelBudgetInputWindow {
    /**
     * 
     */
    kind: ModelBudgetInputWindowKindEnum;
    /**
     * 
     */
    durationMs: number;
}


/**
 * @export
 */
export const ModelBudgetInputWindowKindEnum = {
    Rolling: 'rolling',
} as const;
export type ModelBudgetInputWindowKindEnum = typeof ModelBudgetInputWindowKindEnum[keyof typeof ModelBudgetInputWindowKindEnum];

/**
 * 
 * @export
 * @interface ModelCallView
 */
export interface ModelCallView {
    /**
     * 
     */
    identity: ModelInvocationIdentity;
    /**
     * 
     */
    authorityRef: string;
    /**
     * 
     */
    native?: NativeOrigin;
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
    traceId: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    consumer: Consumer;
    /**
     * 
     */
    roleId: string;
    /**
     * 
     */
    kind: ModelKind;
    /**
     * 
     */
    status: ModelCallViewStatusEnum;
    /**
     * 
     */
    snapshot: InvocationSnapshot;
    /**
     * 
     */
    preparation?: ModelPreparation;
    /**
     * 
     */
    inputRefs: Array<Ref>;
    /**
     * 
     */
    outputRefs: Array<Ref>;
    /**
     * 
     */
    observed?: TimeCaptureReceipt;
    /**
     * 
     */
    formed?: TimeCaptureReceipt;
    /**
     * 
     */
    usage?: NormalizedUsage;
    /**
     * 
     */
    providerRequestId?: string;
    /**
     * 
     */
    reservedCost: Money | null;
    /**
     * 
     */
    actualCost: Money | null;
    /**
     * 
     */
    problem?: Problem;
    /**
     * 
     */
    recordedAt: string;
    /**
     * 
     */
    completedAt?: string;
}


/**
 * @export
 */
export const ModelCallViewStatusEnum = {
    Prepared: 'prepared',
    Dispatched: 'dispatched',
    Completed: 'completed',
    NotSent: 'not_sent',
    Unknown: 'unknown',
} as const;
export type ModelCallViewStatusEnum = typeof ModelCallViewStatusEnum[keyof typeof ModelCallViewStatusEnum];

/**
 * 
 * @export
 * @interface ModelCallViewInput
 */
export interface ModelCallViewInput {
    /**
     * 
     */
    identity: ModelInvocationIdentityInput;
    /**
     * 
     */
    authorityRef: string;
    /**
     * 
     */
    native?: NativeOriginInput;
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
    traceId: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    consumer: ConsumerInput;
    /**
     * 
     */
    roleId: string;
    /**
     * 
     */
    kind: ModelKindInput;
    /**
     * 
     */
    status: ModelCallViewInputStatusEnum;
    /**
     * 
     */
    snapshot: InvocationSnapshotInput;
    /**
     * 
     */
    preparation?: ModelPreparationInput;
    /**
     * 
     */
    inputRefs: Array<RefInput>;
    /**
     * 
     */
    outputRefs: Array<RefInput>;
    /**
     * 
     */
    observed?: TimeCaptureReceiptInput;
    /**
     * 
     */
    formed?: TimeCaptureReceiptInput;
    /**
     * 
     */
    usage?: NormalizedUsageInput;
    /**
     * 
     */
    providerRequestId?: string;
    /**
     * 
     */
    reservedCost: MoneyInput | null;
    /**
     * 
     */
    actualCost: MoneyInput | null;
    /**
     * 
     */
    problem?: ProblemInput;
    /**
     * 
     */
    recordedAt: string;
    /**
     * 
     */
    completedAt?: string;
}


/**
 * @export
 */
export const ModelCallViewInputStatusEnum = {
    Prepared: 'prepared',
    Dispatched: 'dispatched',
    Completed: 'completed',
    NotSent: 'not_sent',
    Unknown: 'unknown',
} as const;
export type ModelCallViewInputStatusEnum = typeof ModelCallViewInputStatusEnum[keyof typeof ModelCallViewInputStatusEnum];

/**
 * 
 * @export
 * @interface ModelDataBundle
 */
export interface ModelDataBundle {
    /**
     * 
     */
    formatVersion: ModelDataBundleFormatVersionEnum;
    /**
     * 
     */
    sourceProduct: ModelDataBundleSourceProductEnum;
    /**
     * 
     */
    sourceInstallationId: string;
    /**
     * 
     */
    subjectId: string | null;
    /**
     * 
     */
    calls: Array<ModelDataRecord>;
}


/**
 * @export
 */
export const ModelDataBundleFormatVersionEnum = {
    NUMBER_1: 1,
} as const;
export type ModelDataBundleFormatVersionEnum = typeof ModelDataBundleFormatVersionEnum[keyof typeof ModelDataBundleFormatVersionEnum];

/**
 * @export
 */
export const ModelDataBundleSourceProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type ModelDataBundleSourceProductEnum = typeof ModelDataBundleSourceProductEnum[keyof typeof ModelDataBundleSourceProductEnum];

/**
 * 
 * @export
 * @interface ModelDataBundleInput
 */
export interface ModelDataBundleInput {
    /**
     * 
     */
    formatVersion: ModelDataBundleInputFormatVersionEnum;
    /**
     * 
     */
    sourceProduct: ModelDataBundleInputSourceProductEnum;
    /**
     * 
     */
    sourceInstallationId: string;
    /**
     * 
     */
    subjectId: string | null;
    /**
     * 
     */
    calls: Array<ModelDataRecordInput>;
}


/**
 * @export
 */
export const ModelDataBundleInputFormatVersionEnum = {
    NUMBER_1: 1,
} as const;
export type ModelDataBundleInputFormatVersionEnum = typeof ModelDataBundleInputFormatVersionEnum[keyof typeof ModelDataBundleInputFormatVersionEnum];

/**
 * @export
 */
export const ModelDataBundleInputSourceProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type ModelDataBundleInputSourceProductEnum = typeof ModelDataBundleInputSourceProductEnum[keyof typeof ModelDataBundleInputSourceProductEnum];

/**
 * 
 * @export
 * @interface ModelDataRecord
 */
export interface ModelDataRecord {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    logicalOperationId: string;
    /**
     * 
     */
    physicalOrdinal: number;
    /**
     * 
     */
    attemptNo: number;
    /**
     * 
     */
    workflowId: string | null;
    /**
     * 
     */
    stepNo: number | null;
    /**
     * 
     */
    batchNo: number | null;
    /**
     * 
     */
    subjectId: string | null;
    /**
     * 
     */
    consumer: Consumer;
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
    authorityRef: string;
    /**
     * 
     */
    traceId: string;
    /**
     * 
     */
    roleId: string;
    /**
     * 
     */
    modelKind: ModelKind;
    /**
     * 
     */
    status: ModelDataRecordStatusEnum;
    /**
     * 
     */
    requestDigest: string;
    /**
     * 
     */
    completionDigest: string | null;
    /**
     * 
     */
    configSnapshot: InvocationSnapshot;
    /**
     * 
     */
    resourceId: string;
    /**
     * 
     */
    resourceRevision: number;
    /**
     * 
     */
    actualProvider: string;
    /**
     * 
     */
    actualModelId: string;
    /**
     * 
     */
    inputSources: Array<Ref>;
    /**
     * 
     */
    semanticInputRefs: Array<Ref>;
    /**
     * 
     */
    outputRefs: Array<Ref>;
    /**
     * 
     */
    observedCapture: TimeCaptureReceipt | null;
    /**
     * 
     */
    formedCapture: TimeCaptureReceipt | null;
    /**
     * 
     */
    preparation: ModelPreparation | null;
    /**
     * 
     */
    tokenEstimate: TokenEstimate;
    /**
     * 
     */
    maxOutputTokens: number;
    /**
     * 
     */
    usage: NormalizedUsage | null;
    /**
     * 
     */
    rawUsage: JsonValue | null;
    /**
     * 
     */
    budgetSnapshot: ModelDataRecordBudgetSnapshot;
    /**
     * 
     */
    budgetKeys: Array<string>;
    /**
     * 
     */
    reservedCost: string | null;
    /**
     * 
     */
    actualCost: string | null;
    /**
     * 
     */
    currency: string | null;
    /**
     * 
     */
    actualTokens: string | null;
    /**
     * 
     */
    providerRequestId: string | null;
    /**
     * 
     */
    problem: Problem | null;
    /**
     * 
     */
    recordedAt: string;
    /**
     * 
     */
    completedAt: string | null;
    /**
     * 
     */
    nativeIdentity: JsonValue | null;
    /**
     * 
     */
    adoptedAt: string | null;
}


/**
 * @export
 */
export const ModelDataRecordStatusEnum = {
    Prepared: 'prepared',
    Dispatched: 'dispatched',
    Completed: 'completed',
    NotSent: 'not_sent',
    Unknown: 'unknown',
} as const;
export type ModelDataRecordStatusEnum = typeof ModelDataRecordStatusEnum[keyof typeof ModelDataRecordStatusEnum];

/**
 * 
 * @export
 * @interface ModelDataRecordBudgetSnapshot
 */
export interface ModelDataRecordBudgetSnapshot {
    /**
     * 
     */
    constraints: Array<ModelDataRecordBudgetSnapshotConstraintsInner>;
}
/**
 * 
 * @export
 * @interface ModelDataRecordBudgetSnapshotConstraintsInner
 */
export interface ModelDataRecordBudgetSnapshotConstraintsInner {
    /**
     * 
     */
    key: string;
    /**
     * 
     */
    budget: ModelBudget;
}
/**
 * 
 * @export
 * @interface ModelDataRecordInput
 */
export interface ModelDataRecordInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    logicalOperationId: string;
    /**
     * 
     */
    physicalOrdinal: number;
    /**
     * 
     */
    attemptNo: number;
    /**
     * 
     */
    workflowId: string | null;
    /**
     * 
     */
    stepNo: number | null;
    /**
     * 
     */
    batchNo: number | null;
    /**
     * 
     */
    subjectId: string | null;
    /**
     * 
     */
    consumer: ConsumerInput;
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
    authorityRef: string;
    /**
     * 
     */
    traceId: string;
    /**
     * 
     */
    roleId: string;
    /**
     * 
     */
    modelKind: ModelKindInput;
    /**
     * 
     */
    status: ModelDataRecordInputStatusEnum;
    /**
     * 
     */
    requestDigest: string;
    /**
     * 
     */
    completionDigest: string | null;
    /**
     * 
     */
    configSnapshot: InvocationSnapshotInput;
    /**
     * 
     */
    resourceId: string;
    /**
     * 
     */
    resourceRevision: number;
    /**
     * 
     */
    actualProvider: string;
    /**
     * 
     */
    actualModelId: string;
    /**
     * 
     */
    inputSources: Array<RefInput>;
    /**
     * 
     */
    semanticInputRefs: Array<RefInput>;
    /**
     * 
     */
    outputRefs: Array<RefInput>;
    /**
     * 
     */
    observedCapture: TimeCaptureReceiptInput | null;
    /**
     * 
     */
    formedCapture: TimeCaptureReceiptInput | null;
    /**
     * 
     */
    preparation: ModelPreparationInput | null;
    /**
     * 
     */
    tokenEstimate: TokenEstimateInput;
    /**
     * 
     */
    maxOutputTokens: number;
    /**
     * 
     */
    usage: NormalizedUsageInput | null;
    /**
     * 
     */
    rawUsage: JsonValueInput | null;
    /**
     * 
     */
    budgetSnapshot: ModelDataRecordInputBudgetSnapshot;
    /**
     * 
     */
    budgetKeys: Array<string>;
    /**
     * 
     */
    reservedCost: string | null;
    /**
     * 
     */
    actualCost: string | null;
    /**
     * 
     */
    currency: string | null;
    /**
     * 
     */
    actualTokens: string | null;
    /**
     * 
     */
    providerRequestId: string | null;
    /**
     * 
     */
    problem: ProblemInput | null;
    /**
     * 
     */
    recordedAt: string;
    /**
     * 
     */
    completedAt: string | null;
    /**
     * 
     */
    nativeIdentity: JsonValueInput | null;
    /**
     * 
     */
    adoptedAt: string | null;
}


/**
 * @export
 */
export const ModelDataRecordInputStatusEnum = {
    Prepared: 'prepared',
    Dispatched: 'dispatched',
    Completed: 'completed',
    NotSent: 'not_sent',
    Unknown: 'unknown',
} as const;
export type ModelDataRecordInputStatusEnum = typeof ModelDataRecordInputStatusEnum[keyof typeof ModelDataRecordInputStatusEnum];

/**
 * 
 * @export
 * @interface ModelDataRecordInputBudgetSnapshot
 */
export interface ModelDataRecordInputBudgetSnapshot {
    /**
     * 
     */
    constraints: Array<ModelDataRecordInputBudgetSnapshotConstraintsInner>;
}
/**
 * 
 * @export
 * @interface ModelDataRecordInputBudgetSnapshotConstraintsInner
 */
export interface ModelDataRecordInputBudgetSnapshotConstraintsInner {
    /**
     * 
     */
    key: string;
    /**
     * 
     */
    budget: ModelBudgetInput;
}
/**
 * @type ModelDefinition
 * 
 * @export
 */
export type ModelDefinition = ModelDefinitionOneOf | ModelRegistrationOneOf;
/**
 * @type ModelDefinitionInput
 * 
 * @export
 */
export type ModelDefinitionInput = ModelDefinitionInputOneOf | ModelRegistrationInputOneOf;
/**
 * 
 * @export
 * @interface ModelDefinitionInputOneOf
 */
export interface ModelDefinitionInputOneOf {
    /**
     * 
     */
    managedBy: ModelDefinitionInputOneOfManagedByEnum;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    binding: NativeModelBindingInput;
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    pricingRef?: string;
}


/**
 * @export
 */
export const ModelDefinitionInputOneOfManagedByEnum = {
    Native: 'native',
} as const;
export type ModelDefinitionInputOneOfManagedByEnum = typeof ModelDefinitionInputOneOfManagedByEnum[keyof typeof ModelDefinitionInputOneOfManagedByEnum];

/**
 * 
 * @export
 * @interface ModelDefinitionOneOf
 */
export interface ModelDefinitionOneOf {
    /**
     * 
     */
    managedBy: ModelDefinitionOneOfManagedByEnum;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    binding: NativeModelBinding;
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    pricingRef?: string;
}


/**
 * @export
 */
export const ModelDefinitionOneOfManagedByEnum = {
    Native: 'native',
} as const;
export type ModelDefinitionOneOfManagedByEnum = typeof ModelDefinitionOneOfManagedByEnum[keyof typeof ModelDefinitionOneOfManagedByEnum];

/**
 * 
 * @export
 * @interface ModelInvocationFilter
 */
export interface ModelInvocationFilter {
    /**
     * 
     */
    logicalOperationId?: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    roleId?: string;
    /**
     * 
     */
    status?: ModelInvocationFilterStatusEnum;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
}


/**
 * @export
 */
export const ModelInvocationFilterStatusEnum = {
    Prepared: 'prepared',
    Dispatched: 'dispatched',
    Completed: 'completed',
    NotSent: 'not_sent',
    Unknown: 'unknown',
} as const;
export type ModelInvocationFilterStatusEnum = typeof ModelInvocationFilterStatusEnum[keyof typeof ModelInvocationFilterStatusEnum];

/**
 * 
 * @export
 * @interface ModelInvocationFilterInput
 */
export interface ModelInvocationFilterInput {
    /**
     * 
     */
    logicalOperationId?: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    roleId?: string;
    /**
     * 
     */
    status?: ModelInvocationFilterInputStatusEnum;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
}


/**
 * @export
 */
export const ModelInvocationFilterInputStatusEnum = {
    Prepared: 'prepared',
    Dispatched: 'dispatched',
    Completed: 'completed',
    NotSent: 'not_sent',
    Unknown: 'unknown',
} as const;
export type ModelInvocationFilterInputStatusEnum = typeof ModelInvocationFilterInputStatusEnum[keyof typeof ModelInvocationFilterInputStatusEnum];

/**
 * 
 * @export
 * @interface ModelInvocationIdentity
 */
export interface ModelInvocationIdentity {
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    logicalOperationId: string;
    /**
     * 
     */
    physicalOrdinal: number;
    /**
     * 
     */
    stepNo?: number;
    /**
     * 
     */
    batchNo?: number;
    /**
     * 
     */
    attemptNo: number;
    /**
     * 
     */
    workflowId?: string;
}
/**
 * 
 * @export
 * @interface ModelInvocationIdentityInput
 */
export interface ModelInvocationIdentityInput {
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    logicalOperationId: string;
    /**
     * 
     */
    physicalOrdinal: number;
    /**
     * 
     */
    stepNo?: number;
    /**
     * 
     */
    batchNo?: number;
    /**
     * 
     */
    attemptNo: number;
    /**
     * 
     */
    workflowId?: string;
}
/**
 * 
 * @export
 * @interface ModelInvocationPage
 */
export interface ModelInvocationPage {
    /**
     * 
     */
    items: Array<ModelCallView>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface ModelInvocationPageInput
 */
export interface ModelInvocationPageInput {
    /**
     * 
     */
    items: Array<ModelCallViewInput>;
    /**
     * 
     */
    nextCursor?: string;
}

/**
 * 
 * @export
 */
export const ModelKind = {
    Language: 'language',
    Embedding: 'embedding',
    Reranking: 'reranking',
    Transcription: 'transcription',
    Speech: 'speech',
} as const;
export type ModelKind = typeof ModelKind[keyof typeof ModelKind];


/**
 * 
 * @export
 */
export const ModelKindInput = {
    Language: 'language',
    Embedding: 'embedding',
    Reranking: 'reranking',
    Transcription: 'transcription',
    Speech: 'speech',
} as const;
export type ModelKindInput = typeof ModelKindInput[keyof typeof ModelKindInput];

/**
 * 
 * @export
 * @interface ModelPreparation
 */
export interface ModelPreparation {
    /**
     * 
     */
    referenceTime: CapturedTime;
    /**
     * 
     */
    inputDigest?: string;
    /**
     * 
     */
    contextRef?: ModelPreparationContextRef;
}
/**
 * 
 * @export
 * @interface ModelPreparationContextRef
 */
export interface ModelPreparationContextRef {
    /**
     * 
     */
    product: ModelPreparationContextRefProductEnum;
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
    kind: ModelPreparationContextRefKindEnum;
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
export const ModelPreparationContextRefProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type ModelPreparationContextRefProductEnum = typeof ModelPreparationContextRefProductEnum[keyof typeof ModelPreparationContextRefProductEnum];

/**
 * @export
 */
export const ModelPreparationContextRefKindEnum = {
    ContextView: 'ContextView',
} as const;
export type ModelPreparationContextRefKindEnum = typeof ModelPreparationContextRefKindEnum[keyof typeof ModelPreparationContextRefKindEnum];

/**
 * 
 * @export
 * @interface ModelPreparationInput
 */
export interface ModelPreparationInput {
    /**
     * 
     */
    referenceTime: CapturedTimeInput;
    /**
     * 
     */
    inputDigest?: string;
    /**
     * 
     */
    contextRef?: ModelPreparationInputContextRef;
}
/**
 * 
 * @export
 * @interface ModelPreparationInputContextRef
 */
export interface ModelPreparationInputContextRef {
    /**
     * 
     */
    product: ModelPreparationInputContextRefProductEnum;
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
    kind: ModelPreparationInputContextRefKindEnum;
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
export const ModelPreparationInputContextRefProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type ModelPreparationInputContextRefProductEnum = typeof ModelPreparationInputContextRefProductEnum[keyof typeof ModelPreparationInputContextRefProductEnum];

/**
 * @export
 */
export const ModelPreparationInputContextRefKindEnum = {
    ContextView: 'ContextView',
} as const;
export type ModelPreparationInputContextRefKindEnum = typeof ModelPreparationInputContextRefKindEnum[keyof typeof ModelPreparationInputContextRefKindEnum];

/**
 * 
 * @export
 * @interface ModelProvidersCreateRequest
 */
export interface ModelProvidersCreateRequest {
    /**
     * 
     */
    definition: ProviderDefinitionInput;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface ModelProvidersDeleteRequest
 */
export interface ModelProvidersDeleteRequest {
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface ModelReconcile
 */
export interface ModelReconcile {
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    status: ModelReconcileStatusEnum;
    /**
     * 
     */
    usage?: NormalizedUsage;
    /**
     * 
     */
    outputRefs?: Array<Ref>;
    /**
     * 
     */
    providerRequestId?: string;
    /**
     * 
     */
    formed?: TimeCaptureReceipt;
}


/**
 * @export
 */
export const ModelReconcileStatusEnum = {
    Completed: 'completed',
    NotSent: 'not_sent',
} as const;
export type ModelReconcileStatusEnum = typeof ModelReconcileStatusEnum[keyof typeof ModelReconcileStatusEnum];

/**
 * 
 * @export
 * @interface ModelReconcileInput
 */
export interface ModelReconcileInput {
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    status: ModelReconcileInputStatusEnum;
    /**
     * 
     */
    usage?: NormalizedUsageInput;
    /**
     * 
     */
    outputRefs?: Array<RefInput>;
    /**
     * 
     */
    providerRequestId?: string;
    /**
     * 
     */
    formed?: TimeCaptureReceiptInput;
}


/**
 * @export
 */
export const ModelReconcileInputStatusEnum = {
    Completed: 'completed',
    NotSent: 'not_sent',
} as const;
export type ModelReconcileInputStatusEnum = typeof ModelReconcileInputStatusEnum[keyof typeof ModelReconcileInputStatusEnum];

/**
 * @type ModelRegistration
 * 
 * @export
 */
export type ModelRegistration = ModelRegistrationInputOneOf1 | ModelRegistrationOneOf;
/**
 * @type ModelRegistrationInput
 * 
 * @export
 */
export type ModelRegistrationInput = ModelRegistrationInputOneOf | ModelRegistrationInputOneOf1;
/**
 * 
 * @export
 * @interface ModelRegistrationInputOneOf
 */
export interface ModelRegistrationInputOneOf {
    /**
     * 
     */
    managedBy: ModelRegistrationInputOneOfManagedByEnum;
    /**
     * 
     */
    definition: ModelResourceInput;
}


/**
 * @export
 */
export const ModelRegistrationInputOneOfManagedByEnum = {
    Sdk: 'sdk',
} as const;
export type ModelRegistrationInputOneOfManagedByEnum = typeof ModelRegistrationInputOneOfManagedByEnum[keyof typeof ModelRegistrationInputOneOfManagedByEnum];

/**
 * 
 * @export
 * @interface ModelRegistrationInputOneOf1
 */
export interface ModelRegistrationInputOneOf1 {
    /**
     * 
     */
    managedBy: ModelRegistrationInputOneOf1ManagedByEnum;
    /**
     * 
     */
    definition: ModelRegistrationInputOneOf1Definition;
}


/**
 * @export
 */
export const ModelRegistrationInputOneOf1ManagedByEnum = {
    Native: 'native',
} as const;
export type ModelRegistrationInputOneOf1ManagedByEnum = typeof ModelRegistrationInputOneOf1ManagedByEnum[keyof typeof ModelRegistrationInputOneOf1ManagedByEnum];

/**
 * 
 * @export
 * @interface ModelRegistrationInputOneOf1Definition
 */
export interface ModelRegistrationInputOneOf1Definition {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    nativeResourceId: string;
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    pricingRef?: string;
}
/**
 * 
 * @export
 * @interface ModelRegistrationOneOf
 */
export interface ModelRegistrationOneOf {
    /**
     * 
     */
    managedBy: ModelRegistrationOneOfManagedByEnum;
    /**
     * 
     */
    definition: ModelResource;
}


/**
 * @export
 */
export const ModelRegistrationOneOfManagedByEnum = {
    Sdk: 'sdk',
} as const;
export type ModelRegistrationOneOfManagedByEnum = typeof ModelRegistrationOneOfManagedByEnum[keyof typeof ModelRegistrationOneOfManagedByEnum];

/**
 * 
 * @export
 * @interface ModelResource
 */
export interface ModelResource {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    label: string;
    /**
     * 
     */
    providerId: string;
    /**
     * 
     */
    modelId: string;
    /**
     * 
     */
    kind: ModelKind;
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    capabilities: Array<string>;
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
    providerOptions: { [key: string]: { [key: string]: JsonValue; }; };
    /**
     * 
     */
    pricingRef?: string;
}


/**
 * 
 * @export
 * @interface ModelResourceInput
 */
export interface ModelResourceInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    label: string;
    /**
     * 
     */
    providerId: string;
    /**
     * 
     */
    modelId: string;
    /**
     * 
     */
    kind: ModelKindInput;
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    capabilities: Array<string>;
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
    providerOptions: { [key: string]: { [key: string]: JsonValueInput; }; };
    /**
     * 
     */
    pricingRef?: string;
}



/**
 * 
 * @export
 */
export const ModelSelection = {
    Ordered: 'ordered',
    Balance: 'balance',
    Random: 'random',
} as const;
export type ModelSelection = typeof ModelSelection[keyof typeof ModelSelection];


/**
 * 
 * @export
 */
export const ModelSelectionInput = {
    Ordered: 'ordered',
    Balance: 'balance',
    Random: 'random',
} as const;
export type ModelSelectionInput = typeof ModelSelectionInput[keyof typeof ModelSelectionInput];

/**
 * 
 * @export
 * @interface ModelTestBody
 */
export interface ModelTestBody {
    /**
     * 
     */
    roleId: string;
    /**
     * 
     */
    prompt: string;
    /**
     * 
     */
    promptParams: JsonValue | null;
    /**
     * 
     */
    resource?: ResourceRef;
    /**
     * 
     */
    maxOutputTokens?: number;
}
/**
 * 
 * @export
 * @interface ModelTestBodyInput
 */
export interface ModelTestBodyInput {
    /**
     * 
     */
    roleId: string;
    /**
     * 
     */
    prompt: string;
    /**
     * 
     */
    promptParams: JsonValueInput | null;
    /**
     * 
     */
    resource?: ResourceRefInput;
    /**
     * 
     */
    maxOutputTokens?: number;
}
/**
 * 
 * @export
 * @interface ModelsCreateRequest
 */
export interface ModelsCreateRequest {
    /**
     * 
     */
    definition: ModelRegistrationInput;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface ModelsDispatchInvocationRequest
 */
export interface ModelsDispatchInvocationRequest {
    /**
     * 
     */
    observed?: TimeCaptureReceiptInput;
}
/**
 * 
 * @export
 * @interface ModelsReconcileRequest
 */
export interface ModelsReconcileRequest {
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    status: ModelsReconcileRequestStatusEnum;
    /**
     * 
     */
    usage?: NormalizedUsageInput;
    /**
     * 
     */
    outputRefs?: Array<RefInput>;
    /**
     * 
     */
    providerRequestId?: string;
    /**
     * 
     */
    formed?: TimeCaptureReceiptInput;
    /**
     * 
     */
    subjectId?: string;
}


/**
 * @export
 */
export const ModelsReconcileRequestStatusEnum = {
    Completed: 'completed',
    NotSent: 'not_sent',
} as const;
export type ModelsReconcileRequestStatusEnum = typeof ModelsReconcileRequestStatusEnum[keyof typeof ModelsReconcileRequestStatusEnum];

/**
 * 
 * @export
 * @interface ModuleDescription
 */
export interface ModuleDescription {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    definitionRevision: string;
    /**
     * 
     */
    owner: string;
    /**
     * 
     */
    jsonSchema: { [key: string]: JsonValue; };
    /**
     * 
     */
    defaults: { [key: string]: JsonValue; };
    /**
     * 
     */
    fields: { [key: string]: FieldMetadata; };
    /**
     * 
     */
    recordedAt?: string;
}
/**
 * 
 * @export
 * @interface ModuleDescriptionInput
 */
export interface ModuleDescriptionInput {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    definitionRevision: string;
    /**
     * 
     */
    owner: string;
    /**
     * 
     */
    jsonSchema: { [key: string]: JsonValueInput; };
    /**
     * 
     */
    defaults: { [key: string]: JsonValueInput; };
    /**
     * 
     */
    fields: { [key: string]: FieldMetadataInput; };
    /**
     * 
     */
    recordedAt?: string;
}
/**
 * 
 * @export
 * @interface Money
 */
export interface Money {
    /**
     * 
     */
    amount: string;
    /**
     * 
     */
    currency: string;
}
/**
 * 
 * @export
 * @interface MoneyInput
 */
export interface MoneyInput {
    /**
     * 
     */
    amount: string;
    /**
     * 
     */
    currency: string;
}
/**
 * 
 * @export
 * @interface Motivation
 */
export interface Motivation {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: MotivationKindEnum;
    /**
     * 
     */
    aspect: MotivationAspectEnum;
    /**
     * 
     */
    importance: number;
    /**
     * 
     */
    criterion?: Criterion;
}


/**
 * @export
 */
export const MotivationKindEnum = {
    Motivation: 'Motivation',
} as const;
export type MotivationKindEnum = typeof MotivationKindEnum[keyof typeof MotivationKindEnum];

/**
 * @export
 */
export const MotivationAspectEnum = {
    Desire: 'desire',
    Concern: 'concern',
    EvaluableExpectation: 'evaluable_expectation',
} as const;
export type MotivationAspectEnum = typeof MotivationAspectEnum[keyof typeof MotivationAspectEnum];

/**
 * 
 * @export
 * @interface MotivationInput
 */
export interface MotivationInput {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: MotivationInputKindEnum;
    /**
     * 
     */
    aspect: MotivationInputAspectEnum;
    /**
     * 
     */
    importance: number;
    /**
     * 
     */
    criterion?: CriterionInput;
}


/**
 * @export
 */
export const MotivationInputKindEnum = {
    Motivation: 'Motivation',
} as const;
export type MotivationInputKindEnum = typeof MotivationInputKindEnum[keyof typeof MotivationInputKindEnum];

/**
 * @export
 */
export const MotivationInputAspectEnum = {
    Desire: 'desire',
    Concern: 'concern',
    EvaluableExpectation: 'evaluable_expectation',
} as const;
export type MotivationInputAspectEnum = typeof MotivationInputAspectEnum[keyof typeof MotivationInputAspectEnum];

/**
 * 
 * @export
 * @interface NativeAuthorityCheckRequest
 */
export interface NativeAuthorityCheckRequest {
    /**
     * 
     */
    native: NativeAuthorityCheckRequestNative;
    /**
     * 
     */
    toolName?: string;
}
/**
 * 
 * @export
 * @interface NativeAuthorityCheckRequestNative
 */
export interface NativeAuthorityCheckRequestNative {
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    sessionKey: string;
    /**
     * 
     */
    sessionId: string;
    /**
     * 
     */
    runId: string;
}
/**
 * 
 * @export
 * @interface NativeCognitionAcceptRequest
 */
export interface NativeCognitionAcceptRequest {
    /**
     * 
     */
    native: NativeAuthorityCheckRequestNative;
    /**
     * 
     */
    input: EncounterAcceptInput;
}
/**
 * 
 * @export
 * @interface NativeCognitionCaptureRequest
 */
export interface NativeCognitionCaptureRequest {
    /**
     * 
     */
    native: NativeAuthorityCheckRequestNative;
    /**
     * 
     */
    input: MaterialCaptureInput;
}
/**
 * 
 * @export
 * @interface NativeCognitionPrepareRequest
 */
export interface NativeCognitionPrepareRequest {
    /**
     * 
     */
    native: NativeAuthorityCheckRequestNative;
    /**
     * 
     */
    input: ContextPrepareInput;
}
/**
 * 
 * @export
 * @interface NativeCognitionUploadBlobNativeParameter
 */
export interface NativeCognitionUploadBlobNativeParameter {
    /**
     * 
     */
    runtimeId?: string;
    /**
     * 
     */
    sessionKey?: string;
    /**
     * 
     */
    sessionId?: string;
    /**
     * 
     */
    runId?: string;
}
/**
 * 
 * @export
 * @interface NativeInvocationCompletion
 */
export interface NativeInvocationCompletion {
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    status: NativeInvocationCompletionStatusEnum;
    /**
     * 
     */
    usage?: NormalizedUsage;
    /**
     * 
     */
    rawUsage?: JsonValue | null;
    /**
     * 
     */
    providerRequestId?: string;
    /**
     * 
     */
    outputRef?: Ref;
    /**
     * 
     */
    formed?: TimeCaptureReceipt;
}


/**
 * @export
 */
export const NativeInvocationCompletionStatusEnum = {
    Completed: 'completed',
    NotSent: 'not_sent',
    Unknown: 'unknown',
} as const;
export type NativeInvocationCompletionStatusEnum = typeof NativeInvocationCompletionStatusEnum[keyof typeof NativeInvocationCompletionStatusEnum];

/**
 * 
 * @export
 * @interface NativeInvocationCompletionInput
 */
export interface NativeInvocationCompletionInput {
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    status: NativeInvocationCompletionInputStatusEnum;
    /**
     * 
     */
    usage?: NormalizedUsageInput;
    /**
     * 
     */
    rawUsage?: JsonValueInput | null;
    /**
     * 
     */
    providerRequestId?: string;
    /**
     * 
     */
    outputRef?: RefInput;
    /**
     * 
     */
    formed?: TimeCaptureReceiptInput;
}


/**
 * @export
 */
export const NativeInvocationCompletionInputStatusEnum = {
    Completed: 'completed',
    NotSent: 'not_sent',
    Unknown: 'unknown',
} as const;
export type NativeInvocationCompletionInputStatusEnum = typeof NativeInvocationCompletionInputStatusEnum[keyof typeof NativeInvocationCompletionInputStatusEnum];

/**
 * 
 * @export
 * @interface NativeInvocationPrepare
 */
export interface NativeInvocationPrepare {
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    roleId: string;
    /**
     * 
     */
    modelResourceId: string;
    /**
     * 
     */
    actualProvider: string;
    /**
     * 
     */
    actualModelId: string;
    /**
     * 
     */
    native: NativeOrigin;
    /**
     * 
     */
    inputTokensEstimate: TokenEstimate;
    /**
     * 
     */
    maxOutputTokens: number;
    /**
     * 
     */
    inputRefs: Array<Ref>;
    /**
     * 
     */
    preparation?: ModelPreparation;
    /**
     * 
     */
    budgetAllocation?: BudgetAllocationUse;
}
/**
 * 
 * @export
 * @interface NativeInvocationPrepareInput
 */
export interface NativeInvocationPrepareInput {
    /**
     * 
     */
    invocationId: string;
    /**
     * 
     */
    roleId: string;
    /**
     * 
     */
    modelResourceId: string;
    /**
     * 
     */
    actualProvider: string;
    /**
     * 
     */
    actualModelId: string;
    /**
     * 
     */
    native: NativeOriginInput;
    /**
     * 
     */
    inputTokensEstimate: TokenEstimateInput;
    /**
     * 
     */
    maxOutputTokens: number;
    /**
     * 
     */
    inputRefs: Array<RefInput>;
    /**
     * 
     */
    preparation?: ModelPreparationInput;
    /**
     * 
     */
    budgetAllocation?: BudgetAllocationUseInput;
}
/**
 * 
 * @export
 * @interface NativeModelBinding
 */
export interface NativeModelBinding {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    nativeResourceId: string;
    /**
     * 
     */
    configRevision: string;
    /**
     * 
     */
    actualProvider: string;
    /**
     * 
     */
    actualModelId: string;
    /**
     * 
     */
    kind: ModelKind;
    /**
     * 
     */
    capabilities: Array<string>;
    /**
     * 
     */
    contextLimit?: number;
    /**
     * 
     */
    outputLimit?: number;
}


/**
 * 
 * @export
 * @interface NativeModelBindingInput
 */
export interface NativeModelBindingInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    nativeResourceId: string;
    /**
     * 
     */
    configRevision: string;
    /**
     * 
     */
    actualProvider: string;
    /**
     * 
     */
    actualModelId: string;
    /**
     * 
     */
    kind: ModelKindInput;
    /**
     * 
     */
    capabilities: Array<string>;
    /**
     * 
     */
    contextLimit?: number;
    /**
     * 
     */
    outputLimit?: number;
}


/**
 * 
 * @export
 * @interface NativeOrigin
 */
export interface NativeOrigin {
    /**
     * 
     */
    type: NativeOriginTypeEnum;
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    sessionId: string;
    /**
     * 
     */
    sessionKey: string;
    /**
     * 
     */
    runId: string;
    /**
     * 
     */
    entryId?: string;
    /**
     * 
     */
    callId: string;
}


/**
 * @export
 */
export const NativeOriginTypeEnum = {
    Native: 'native',
} as const;
export type NativeOriginTypeEnum = typeof NativeOriginTypeEnum[keyof typeof NativeOriginTypeEnum];

/**
 * 
 * @export
 * @interface NativeOriginInput
 */
export interface NativeOriginInput {
    /**
     * 
     */
    type: NativeOriginInputTypeEnum;
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    sessionId: string;
    /**
     * 
     */
    sessionKey: string;
    /**
     * 
     */
    runId: string;
    /**
     * 
     */
    entryId?: string;
    /**
     * 
     */
    callId: string;
}


/**
 * @export
 */
export const NativeOriginInputTypeEnum = {
    Native: 'native',
} as const;
export type NativeOriginInputTypeEnum = typeof NativeOriginInputTypeEnum[keyof typeof NativeOriginInputTypeEnum];

/**
 * 
 * @export
 * @interface NetworkProbeRequest
 */
export interface NetworkProbeRequest {
    /**
     * 
     */
    resourceRef: RefInput;
    /**
     * 
     */
    kind: NetworkProbeRequestKindEnum;
    /**
     * 
     */
    url: string;
}


/**
 * @export
 */
export const NetworkProbeRequestKindEnum = {
    Dns: 'dns',
    Tls: 'tls',
    Http: 'http',
} as const;
export type NetworkProbeRequestKindEnum = typeof NetworkProbeRequestKindEnum[keyof typeof NetworkProbeRequestKindEnum];

/**
 * 
 * @export
 * @interface NormalizedUsage
 */
export interface NormalizedUsage {
    /**
     * 
     */
    inputTokens?: number;
    /**
     * 
     */
    outputTokens?: number;
    /**
     * 
     */
    cacheReadTokens?: number;
    /**
     * 
     */
    cacheWriteTokens?: number;
    /**
     * 
     */
    reasoningTokens?: number;
    /**
     * 
     */
    units?: Array<UsageQuantity>;
}
/**
 * 
 * @export
 * @interface NormalizedUsageInput
 */
export interface NormalizedUsageInput {
    /**
     * 
     */
    inputTokens?: number;
    /**
     * 
     */
    outputTokens?: number;
    /**
     * 
     */
    cacheReadTokens?: number;
    /**
     * 
     */
    cacheWriteTokens?: number;
    /**
     * 
     */
    reasoningTokens?: number;
    /**
     * 
     */
    units?: Array<UsageQuantityInput>;
}
/**
 * 
 * @export
 * @interface ObjectRelation
 */
export interface ObjectRelation {
    /**
     * 
     */
    fromId: string;
    /**
     * 
     */
    toId: string;
    /**
     * 
     */
    relation: string;
    /**
     * 
     */
    weight: number;
    /**
     * 
     */
    evidenceRefs: Array<Ref>;
    /**
     * 
     */
    formed: TimePoint;
    /**
     * 
     */
    valid?: TimeRange | null;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    relationId: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    roots: Array<Ref>;
    /**
     * 
     */
    recordedAt: string;
}
/**
 * 
 * @export
 * @interface ObjectRelationInput
 */
export interface ObjectRelationInput {
    /**
     * 
     */
    fromId: string;
    /**
     * 
     */
    toId: string;
    /**
     * 
     */
    relation: string;
    /**
     * 
     */
    weight?: number;
    /**
     * 
     */
    evidenceRefs: Array<RefInput>;
    /**
     * 
     */
    formed: TimePointInput;
    /**
     * 
     */
    valid?: TimeRangeInput | null;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    relationId: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    roots: Array<RefInput>;
    /**
     * 
     */
    recordedAt: string;
}
/**
 * 
 * @export
 * @interface OperationControl
 */
export interface OperationControl {
    /**
     * 
     */
    subjectId?: string;
}
/**
 * 
 * @export
 * @interface OperationControlInput
 */
export interface OperationControlInput {
    /**
     * 
     */
    subjectId?: string;
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
 * @interface OperationTrace
 */
export interface OperationTrace {
    /**
     * 
     */
    operation: OperationView;
    /**
     * 
     */
    steps: Array<OperationTraceStepsInner>;
}
/**
 * 
 * @export
 * @interface OperationTraceInput
 */
export interface OperationTraceInput {
    /**
     * 
     */
    operation: OperationViewInput;
    /**
     * 
     */
    steps: Array<OperationTraceInputStepsInner>;
}
/**
 * 
 * @export
 * @interface OperationTraceInputStepsInner
 */
export interface OperationTraceInputStepsInner {
    /**
     * 
     */
    functionID: number;
    /**
     * 
     */
    name: string;
    /**
     * 
     */
    status: OperationTraceInputStepsInnerStatusEnum;
    /**
     * 
     */
    childWorkflowID?: string;
    /**
     * 
     */
    startedAtEpochMs?: number;
    /**
     * 
     */
    completedAtEpochMs?: number;
    /**
     * 
     */
    problem?: ProblemInput;
}


/**
 * @export
 */
export const OperationTraceInputStepsInnerStatusEnum = {
    Completed: 'completed',
    Failed: 'failed',
} as const;
export type OperationTraceInputStepsInnerStatusEnum = typeof OperationTraceInputStepsInnerStatusEnum[keyof typeof OperationTraceInputStepsInnerStatusEnum];

/**
 * 
 * @export
 * @interface OperationTraceStepsInner
 */
export interface OperationTraceStepsInner {
    /**
     * 
     */
    functionID: number;
    /**
     * 
     */
    name: string;
    /**
     * 
     */
    status: OperationTraceStepsInnerStatusEnum;
    /**
     * 
     */
    childWorkflowID?: string;
    /**
     * 
     */
    startedAtEpochMs?: number;
    /**
     * 
     */
    completedAtEpochMs?: number;
    /**
     * 
     */
    problem?: Problem;
}


/**
 * @export
 */
export const OperationTraceStepsInnerStatusEnum = {
    Completed: 'completed',
    Failed: 'failed',
} as const;
export type OperationTraceStepsInnerStatusEnum = typeof OperationTraceStepsInnerStatusEnum[keyof typeof OperationTraceStepsInnerStatusEnum];

/**
 * 
 * @export
 * @interface OperationView
 */
export interface OperationView {
    /**
     * 
     */
    operationId: string;
    /**
     * 
     */
    status: OperationViewStatusEnum;
    /**
     * 
     */
    nativeStatus: string;
    /**
     * 
     */
    createdAtEpochMs: number;
    /**
     * 
     */
    updatedAtEpochMs?: number;
    /**
     * 
     */
    completedAtEpochMs?: number;
    /**
     * 
     */
    traceId?: string;
    /**
     * 
     */
    operation: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    parentOperationId?: string;
    /**
     * 
     */
    queueName?: string;
    /**
     * 
     */
    applicationVersion?: string;
    /**
     * 
     */
    recoveryAttempts?: number;
    /**
     * 
     */
    problem?: Problem;
}


/**
 * @export
 */
export const OperationViewStatusEnum = {
    Queued: 'queued',
    Running: 'running',
    Waiting: 'waiting',
    Completed: 'completed',
    Failed: 'failed',
    Cancelled: 'cancelled',
} as const;
export type OperationViewStatusEnum = typeof OperationViewStatusEnum[keyof typeof OperationViewStatusEnum];

/**
 * 
 * @export
 * @interface OperationViewInput
 */
export interface OperationViewInput {
    /**
     * 
     */
    operationId: string;
    /**
     * 
     */
    status: OperationViewInputStatusEnum;
    /**
     * 
     */
    nativeStatus: string;
    /**
     * 
     */
    createdAtEpochMs: number;
    /**
     * 
     */
    updatedAtEpochMs?: number;
    /**
     * 
     */
    completedAtEpochMs?: number;
    /**
     * 
     */
    traceId?: string;
    /**
     * 
     */
    operation: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    parentOperationId?: string;
    /**
     * 
     */
    queueName?: string;
    /**
     * 
     */
    applicationVersion?: string;
    /**
     * 
     */
    recoveryAttempts?: number;
    /**
     * 
     */
    problem?: ProblemInput;
}


/**
 * @export
 */
export const OperationViewInputStatusEnum = {
    Queued: 'queued',
    Running: 'running',
    Waiting: 'waiting',
    Completed: 'completed',
    Failed: 'failed',
    Cancelled: 'cancelled',
} as const;
export type OperationViewInputStatusEnum = typeof OperationViewInputStatusEnum[keyof typeof OperationViewInputStatusEnum];

/**
 * @type OriginIdentity
 * 
 * @export
 */
export type OriginIdentity = OriginIdentityInputOneOf | OriginIdentityInputOneOf1 | OriginIdentityInputOneOf2;
/**
 * @type OriginIdentityInput
 * 
 * @export
 */
export type OriginIdentityInput = OriginIdentityInputOneOf | OriginIdentityInputOneOf1 | OriginIdentityInputOneOf2;
/**
 * 
 * @export
 * @interface OriginIdentityInputOneOf
 */
export interface OriginIdentityInputOneOf {
    /**
     * 
     */
    type: OriginIdentityInputOneOfTypeEnum;
    /**
     * 
     */
    adapterId: string;
    /**
     * 
     */
    accountId: string;
    /**
     * 
     */
    conversationId: string;
    /**
     * 
     */
    messageId: string;
    /**
     * 
     */
    nodePath?: Array<string>;
}


/**
 * @export
 */
export const OriginIdentityInputOneOfTypeEnum = {
    Platform: 'platform',
} as const;
export type OriginIdentityInputOneOfTypeEnum = typeof OriginIdentityInputOneOfTypeEnum[keyof typeof OriginIdentityInputOneOfTypeEnum];

/**
 * 
 * @export
 * @interface OriginIdentityInputOneOf1
 */
export interface OriginIdentityInputOneOf1 {
    /**
     * 
     */
    type: OriginIdentityInputOneOf1TypeEnum;
    /**
     * 
     */
    connectorId: string;
    /**
     * 
     */
    documentId: string;
    /**
     * 
     */
    version?: string;
}


/**
 * @export
 */
export const OriginIdentityInputOneOf1TypeEnum = {
    Resource: 'resource',
} as const;
export type OriginIdentityInputOneOf1TypeEnum = typeof OriginIdentityInputOneOf1TypeEnum[keyof typeof OriginIdentityInputOneOf1TypeEnum];

/**
 * 
 * @export
 * @interface OriginIdentityInputOneOf2
 */
export interface OriginIdentityInputOneOf2 {
    /**
     * 
     */
    type: OriginIdentityInputOneOf2TypeEnum;
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    sessionId: string;
    /**
     * 
     */
    sessionKey?: string;
    /**
     * 
     */
    runId?: string;
    /**
     * 
     */
    entryId?: string;
    /**
     * 
     */
    callId?: string;
}


/**
 * @export
 */
export const OriginIdentityInputOneOf2TypeEnum = {
    Native: 'native',
} as const;
export type OriginIdentityInputOneOf2TypeEnum = typeof OriginIdentityInputOneOf2TypeEnum[keyof typeof OriginIdentityInputOneOf2TypeEnum];

/**
 * @type PatchOperation
 * 
 * @export
 */
export type PatchOperation = PatchOperationInputOneOf3 | PatchOperationInputOneOf4 | PatchOperationInputOneOf5 | PatchOperationOneOf | PatchOperationOneOf1 | PatchOperationOneOf2;
/**
 * @type PatchOperationInput
 * 
 * @export
 */
export type PatchOperationInput = PatchOperationInputOneOf | PatchOperationInputOneOf1 | PatchOperationInputOneOf2 | PatchOperationInputOneOf3 | PatchOperationInputOneOf4 | PatchOperationInputOneOf5;
/**
 * 
 * @export
 * @interface PatchOperationInputOneOf
 */
export interface PatchOperationInputOneOf {
    /**
     * 
     */
    op: PatchOperationInputOneOfOpEnum;
    /**
     * 
     */
    path: string;
    /**
     * 
     */
    value: JsonValueInput | null;
}


/**
 * @export
 */
export const PatchOperationInputOneOfOpEnum = {
    Add: 'add',
} as const;
export type PatchOperationInputOneOfOpEnum = typeof PatchOperationInputOneOfOpEnum[keyof typeof PatchOperationInputOneOfOpEnum];

/**
 * 
 * @export
 * @interface PatchOperationInputOneOf1
 */
export interface PatchOperationInputOneOf1 {
    /**
     * 
     */
    op: PatchOperationInputOneOf1OpEnum;
    /**
     * 
     */
    path: string;
    /**
     * 
     */
    value: JsonValueInput | null;
}


/**
 * @export
 */
export const PatchOperationInputOneOf1OpEnum = {
    Replace: 'replace',
} as const;
export type PatchOperationInputOneOf1OpEnum = typeof PatchOperationInputOneOf1OpEnum[keyof typeof PatchOperationInputOneOf1OpEnum];

/**
 * 
 * @export
 * @interface PatchOperationInputOneOf2
 */
export interface PatchOperationInputOneOf2 {
    /**
     * 
     */
    op: PatchOperationInputOneOf2OpEnum;
    /**
     * 
     */
    path: string;
    /**
     * 
     */
    value: JsonValueInput | null;
}


/**
 * @export
 */
export const PatchOperationInputOneOf2OpEnum = {
    Test: 'test',
} as const;
export type PatchOperationInputOneOf2OpEnum = typeof PatchOperationInputOneOf2OpEnum[keyof typeof PatchOperationInputOneOf2OpEnum];

/**
 * 
 * @export
 * @interface PatchOperationInputOneOf3
 */
export interface PatchOperationInputOneOf3 {
    /**
     * 
     */
    op: PatchOperationInputOneOf3OpEnum;
    /**
     * 
     */
    path: string;
}


/**
 * @export
 */
export const PatchOperationInputOneOf3OpEnum = {
    Remove: 'remove',
} as const;
export type PatchOperationInputOneOf3OpEnum = typeof PatchOperationInputOneOf3OpEnum[keyof typeof PatchOperationInputOneOf3OpEnum];

/**
 * 
 * @export
 * @interface PatchOperationInputOneOf4
 */
export interface PatchOperationInputOneOf4 {
    /**
     * 
     */
    op: PatchOperationInputOneOf4OpEnum;
    /**
     * 
     */
    path: string;
    /**
     * 
     */
    from: string;
}


/**
 * @export
 */
export const PatchOperationInputOneOf4OpEnum = {
    Move: 'move',
} as const;
export type PatchOperationInputOneOf4OpEnum = typeof PatchOperationInputOneOf4OpEnum[keyof typeof PatchOperationInputOneOf4OpEnum];

/**
 * 
 * @export
 * @interface PatchOperationInputOneOf5
 */
export interface PatchOperationInputOneOf5 {
    /**
     * 
     */
    op: PatchOperationInputOneOf5OpEnum;
    /**
     * 
     */
    path: string;
    /**
     * 
     */
    from: string;
}


/**
 * @export
 */
export const PatchOperationInputOneOf5OpEnum = {
    Copy: 'copy',
} as const;
export type PatchOperationInputOneOf5OpEnum = typeof PatchOperationInputOneOf5OpEnum[keyof typeof PatchOperationInputOneOf5OpEnum];

/**
 * 
 * @export
 * @interface PatchOperationOneOf
 */
export interface PatchOperationOneOf {
    /**
     * 
     */
    op: PatchOperationOneOfOpEnum;
    /**
     * 
     */
    path: string;
    /**
     * 
     */
    value: JsonValue | null;
}


/**
 * @export
 */
export const PatchOperationOneOfOpEnum = {
    Add: 'add',
} as const;
export type PatchOperationOneOfOpEnum = typeof PatchOperationOneOfOpEnum[keyof typeof PatchOperationOneOfOpEnum];

/**
 * 
 * @export
 * @interface PatchOperationOneOf1
 */
export interface PatchOperationOneOf1 {
    /**
     * 
     */
    op: PatchOperationOneOf1OpEnum;
    /**
     * 
     */
    path: string;
    /**
     * 
     */
    value: JsonValue | null;
}


/**
 * @export
 */
export const PatchOperationOneOf1OpEnum = {
    Replace: 'replace',
} as const;
export type PatchOperationOneOf1OpEnum = typeof PatchOperationOneOf1OpEnum[keyof typeof PatchOperationOneOf1OpEnum];

/**
 * 
 * @export
 * @interface PatchOperationOneOf2
 */
export interface PatchOperationOneOf2 {
    /**
     * 
     */
    op: PatchOperationOneOf2OpEnum;
    /**
     * 
     */
    path: string;
    /**
     * 
     */
    value: JsonValue | null;
}


/**
 * @export
 */
export const PatchOperationOneOf2OpEnum = {
    Test: 'test',
} as const;
export type PatchOperationOneOf2OpEnum = typeof PatchOperationOneOf2OpEnum[keyof typeof PatchOperationOneOf2OpEnum];

/**
 * 
 * @export
 * @interface PeopleLinkAccountsRequest
 */
export interface PeopleLinkAccountsRequest {
    /**
     * 
     */
    account: PeopleLinkAccountsRequestAccount;
    /**
     * 
     */
    basisRefs: Array<RefInput>;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface PeopleLinkAccountsRequestAccount
 */
export interface PeopleLinkAccountsRequestAccount {
    /**
     * 
     */
    channelAccount: string;
    /**
     * 
     */
    platformAccountId: string;
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
 * @interface Portion
 */
export interface Portion {
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    coverage?: string;
}
/**
 * 
 * @export
 * @interface PortionInput
 */
export interface PortionInput {
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    coverage?: string;
}
/**
 * 
 * @export
 * @interface PriceBook
 */
export interface PriceBook {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    rates: Array<PriceRate>;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface PriceBookInput
 */
export interface PriceBookInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    rates: Array<PriceRateInput>;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface PriceDefinition
 */
export interface PriceDefinition {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    rates: Array<PriceRate>;
}
/**
 * 
 * @export
 * @interface PriceDefinitionInput
 */
export interface PriceDefinitionInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    rates: Array<PriceRateInput>;
}
/**
 * 
 * @export
 * @interface PriceRate
 */
export interface PriceRate {
    /**
     * 
     */
    unit: string;
    /**
     * 
     */
    amount: Money;
    /**
     * 
     */
    per: string;
}
/**
 * 
 * @export
 * @interface PriceRateInput
 */
export interface PriceRateInput {
    /**
     * 
     */
    unit: string;
    /**
     * 
     */
    amount: MoneyInput;
    /**
     * 
     */
    per: string;
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
    code: string;
    /**
     * 
     */
    category: ProblemCategoryEnum;
    /**
     * 
     */
    status: number;
    /**
     * 
     */
    messageKey: string;
    /**
     * 
     */
    args?: { [key: string]: ProblemInputArgsValue; };
    /**
     * 
     */
    message: string;
    /**
     * 
     */
    operationId?: string;
    /**
     * 
     */
    traceId?: string;
    /**
     * 
     */
    currentRevision?: number;
    /**
     * 
     */
    retry?: ProblemRetry;
    /**
     * 
     */
    details?: { [key: string]: JsonValue; };
}


/**
 * @export
 */
export const ProblemCategoryEnum = {
    Validation: 'validation',
    Forbidden: 'forbidden',
    NotFound: 'not_found',
    Conflict: 'conflict',
    Unavailable: 'unavailable',
    ResourcePressure: 'resource_pressure',
    Budget: 'budget',
    EffectUnknown: 'effect_unknown',
    Failed: 'failed',
} as const;
export type ProblemCategoryEnum = typeof ProblemCategoryEnum[keyof typeof ProblemCategoryEnum];

/**
 * 
 * @export
 * @interface ProblemInput
 */
export interface ProblemInput {
    /**
     * 
     */
    code: string;
    /**
     * 
     */
    category: ProblemInputCategoryEnum;
    /**
     * 
     */
    status: number;
    /**
     * 
     */
    messageKey: string;
    /**
     * 
     */
    args?: { [key: string]: ProblemInputArgsValue; };
    /**
     * 
     */
    message: string;
    /**
     * 
     */
    operationId?: string;
    /**
     * 
     */
    traceId?: string;
    /**
     * 
     */
    currentRevision?: number;
    /**
     * 
     */
    retry?: ProblemInputRetry;
    /**
     * 
     */
    details?: { [key: string]: JsonValueInput; };
}


/**
 * @export
 */
export const ProblemInputCategoryEnum = {
    Validation: 'validation',
    Forbidden: 'forbidden',
    NotFound: 'not_found',
    Conflict: 'conflict',
    Unavailable: 'unavailable',
    ResourcePressure: 'resource_pressure',
    Budget: 'budget',
    EffectUnknown: 'effect_unknown',
    Failed: 'failed',
} as const;
export type ProblemInputCategoryEnum = typeof ProblemInputCategoryEnum[keyof typeof ProblemInputCategoryEnum];

/**
 * 
 * @export
 * @interface ProblemInputArgsValue
 */
export interface ProblemInputArgsValue {
}
/**
 * 
 * @export
 * @interface ProblemInputRetry
 */
export interface ProblemInputRetry {
    /**
     * 
     */
    mode: ProblemInputRetryModeEnum;
    /**
     * 
     */
    at?: string;
}


/**
 * @export
 */
export const ProblemInputRetryModeEnum = {
    AfterChange: 'after_change',
    AfterDelay: 'after_delay',
    Reconcile: 'reconcile',
    None: 'none',
} as const;
export type ProblemInputRetryModeEnum = typeof ProblemInputRetryModeEnum[keyof typeof ProblemInputRetryModeEnum];

/**
 * 
 * @export
 * @interface ProblemRetry
 */
export interface ProblemRetry {
    /**
     * 
     */
    mode: ProblemRetryModeEnum;
    /**
     * 
     */
    at?: string;
}


/**
 * @export
 */
export const ProblemRetryModeEnum = {
    AfterChange: 'after_change',
    AfterDelay: 'after_delay',
    Reconcile: 'reconcile',
    None: 'none',
} as const;
export type ProblemRetryModeEnum = typeof ProblemRetryModeEnum[keyof typeof ProblemRetryModeEnum];

/**
 * 
 * @export
 * @interface PromptActivateRequest
 */
export interface PromptActivateRequest {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface PromptActivateRequestInput
 */
export interface PromptActivateRequestInput {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface PromptBinding
 */
export interface PromptBinding {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale?: string;
    /**
     * 
     */
    revision?: number;
}
/**
 * 
 * @export
 * @interface PromptBindingInput
 */
export interface PromptBindingInput {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale?: string;
    /**
     * 
     */
    revision?: number;
}
/**
 * 
 * @export
 * @interface PromptChangeResult
 */
export interface PromptChangeResult {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    latestRevision: number;
    /**
     * 
     */
    activeRevision: number | null;
    /**
     * 
     */
    changed: boolean;
    /**
     * 
     */
    snapshot?: PromptSnapshot;
}
/**
 * 
 * @export
 * @interface PromptChangeResultInput
 */
export interface PromptChangeResultInput {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    latestRevision: number;
    /**
     * 
     */
    activeRevision: number | null;
    /**
     * 
     */
    changed: boolean;
    /**
     * 
     */
    snapshot?: PromptSnapshotInput;
}
/**
 * 
 * @export
 * @interface PromptDescribeBody
 */
export interface PromptDescribeBody {
    /**
     * 
     */
    owner?: string;
    /**
     * 
     */
    scope?: PromptScope;
}
/**
 * 
 * @export
 * @interface PromptDescribeBodyInput
 */
export interface PromptDescribeBodyInput {
    /**
     * 
     */
    owner?: string;
    /**
     * 
     */
    scope?: PromptScopeInput;
}
/**
 * 
 * @export
 * @interface PromptDescription
 */
export interface PromptDescription {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    owner: string;
    /**
     * 
     */
    labelKey: string;
    /**
     * 
     */
    descriptionKey: string;
    /**
     * 
     */
    visibility: PromptDescriptionVisibilityEnum;
    /**
     * 
     */
    locales: Array<string>;
    /**
     * 
     */
    defaultLocale: string;
    /**
     * 
     */
    paramsSchema: { [key: string]: JsonValue; };
    /**
     * 
     */
    paramsSchemaRevision: string;
    /**
     * 
     */
    allowedPartials: Array<string>;
    /**
     * 
     */
    catalogRevision: string;
}


/**
 * @export
 */
export const PromptDescriptionVisibilityEnum = {
    Standard: 'standard',
    Advanced: 'advanced',
    Developer: 'developer',
} as const;
export type PromptDescriptionVisibilityEnum = typeof PromptDescriptionVisibilityEnum[keyof typeof PromptDescriptionVisibilityEnum];

/**
 * 
 * @export
 * @interface PromptDescriptionInput
 */
export interface PromptDescriptionInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    owner: string;
    /**
     * 
     */
    labelKey: string;
    /**
     * 
     */
    descriptionKey: string;
    /**
     * 
     */
    visibility: PromptDescriptionInputVisibilityEnum;
    /**
     * 
     */
    locales: Array<string>;
    /**
     * 
     */
    defaultLocale: string;
    /**
     * 
     */
    paramsSchema: { [key: string]: JsonValueInput; };
    /**
     * 
     */
    paramsSchemaRevision: string;
    /**
     * 
     */
    allowedPartials: Array<string>;
    /**
     * 
     */
    catalogRevision: string;
}


/**
 * @export
 */
export const PromptDescriptionInputVisibilityEnum = {
    Standard: 'standard',
    Advanced: 'advanced',
    Developer: 'developer',
} as const;
export type PromptDescriptionInputVisibilityEnum = typeof PromptDescriptionInputVisibilityEnum[keyof typeof PromptDescriptionInputVisibilityEnum];

/**
 * 
 * @export
 * @interface PromptHistoryBody
 */
export interface PromptHistoryBody {
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
}
/**
 * 
 * @export
 * @interface PromptHistoryBodyInput
 */
export interface PromptHistoryBodyInput {
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
}
/**
 * 
 * @export
 * @interface PromptHistoryPage
 */
export interface PromptHistoryPage {
    /**
     * 
     */
    items: Array<PromptRevision>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface PromptHistoryPageInput
 */
export interface PromptHistoryPageInput {
    /**
     * 
     */
    items: Array<PromptRevisionInput>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface PromptListBody
 */
export interface PromptListBody {
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
}
/**
 * 
 * @export
 * @interface PromptListBodyInput
 */
export interface PromptListBodyInput {
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
}
/**
 * 
 * @export
 * @interface PromptListItem
 */
export interface PromptListItem {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    latestRevision: number;
    /**
     * 
     */
    activeRevision: number | null;
}
/**
 * 
 * @export
 * @interface PromptListItemInput
 */
export interface PromptListItemInput {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    latestRevision: number;
    /**
     * 
     */
    activeRevision: number | null;
}
/**
 * 
 * @export
 * @interface PromptListPage
 */
export interface PromptListPage {
    /**
     * 
     */
    items: Array<PromptListItem>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface PromptListPageInput
 */
export interface PromptListPageInput {
    /**
     * 
     */
    items: Array<PromptListItemInput>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface PromptPreviewRequest
 */
export interface PromptPreviewRequest {
    /**
     * 
     */
    binding: PromptBinding;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    params: JsonValue | null;
    /**
     * 
     */
    unsavedText?: string;
}
/**
 * 
 * @export
 * @interface PromptPreviewRequestInput
 */
export interface PromptPreviewRequestInput {
    /**
     * 
     */
    binding: PromptBindingInput;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    params: JsonValueInput | null;
    /**
     * 
     */
    unsavedText?: string;
}
/**
 * @type PromptPreviewResult
 * 
 * @export
 */
export type PromptPreviewResult = PromptPreviewResultOneOf | PromptPreviewResultOneOf1;
/**
 * @type PromptPreviewResultInput
 * 
 * @export
 */
export type PromptPreviewResultInput = PromptPreviewResultInputOneOf | PromptPreviewResultInputOneOf1;
/**
 * 
 * @export
 * @interface PromptPreviewResultInputOneOf
 */
export interface PromptPreviewResultInputOneOf {
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    bytes: number;
    /**
     * 
     */
    snapshot: PromptSnapshotInput;
    /**
     * 
     */
    persisted: boolean;
}
/**
 * 
 * @export
 * @interface PromptPreviewResultInputOneOf1
 */
export interface PromptPreviewResultInputOneOf1 {
    /**
     * 
     */
    persisted: boolean;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    bytes: number;
    /**
     * 
     */
    snapshot: PromptPreviewResultInputOneOf1SnapshotEnum | null;
    /**
     * 
     */
    draft: PromptPreviewResultInputOneOf1Draft;
}


/**
 * @export
 */
export const PromptPreviewResultInputOneOf1SnapshotEnum = {
} as const;
export type PromptPreviewResultInputOneOf1SnapshotEnum = typeof PromptPreviewResultInputOneOf1SnapshotEnum[keyof typeof PromptPreviewResultInputOneOf1SnapshotEnum];

/**
 * 
 * @export
 * @interface PromptPreviewResultInputOneOf1Draft
 */
export interface PromptPreviewResultInputOneOf1Draft {
    /**
     * 
     */
    digest: string;
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    dependencies: Array<PromptSnapshotInputDependenciesInner>;
    /**
     * 
     */
    engine: PromptSnapshotInputEngine;
}
/**
 * 
 * @export
 * @interface PromptPreviewResultOneOf
 */
export interface PromptPreviewResultOneOf {
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    bytes: number;
    /**
     * 
     */
    snapshot: PromptSnapshot;
    /**
     * 
     */
    persisted: boolean;
}
/**
 * 
 * @export
 * @interface PromptPreviewResultOneOf1
 */
export interface PromptPreviewResultOneOf1 {
    /**
     * 
     */
    persisted: boolean;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    bytes: number;
    /**
     * 
     */
    snapshot: PromptPreviewResultOneOf1SnapshotEnum | null;
    /**
     * 
     */
    draft: PromptPreviewResultOneOf1Draft;
}


/**
 * @export
 */
export const PromptPreviewResultOneOf1SnapshotEnum = {
} as const;
export type PromptPreviewResultOneOf1SnapshotEnum = typeof PromptPreviewResultOneOf1SnapshotEnum[keyof typeof PromptPreviewResultOneOf1SnapshotEnum];

/**
 * 
 * @export
 * @interface PromptPreviewResultOneOf1Draft
 */
export interface PromptPreviewResultOneOf1Draft {
    /**
     * 
     */
    digest: string;
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    dependencies: Array<PromptSnapshotDependenciesInner>;
    /**
     * 
     */
    engine: PromptSnapshotInputEngine;
}
/**
 * 
 * @export
 * @interface PromptReadRequest
 */
export interface PromptReadRequest {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    revision?: number;
}
/**
 * 
 * @export
 * @interface PromptReadRequestInput
 */
export interface PromptReadRequestInput {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    revision?: number;
}
/**
 * 
 * @export
 * @interface PromptReadResult
 */
export interface PromptReadResult {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    requestedLocale: string;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    sourceScope: PromptScope;
    /**
     * 
     */
    source: PromptReadResultSourceEnum;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    sourceRevision?: number;
    /**
     * 
     */
    digest: string;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    latestRevision: number;
    /**
     * 
     */
    activeRevision: number | null;
}


/**
 * @export
 */
export const PromptReadResultSourceEnum = {
    Program: 'program',
    Override: 'override',
} as const;
export type PromptReadResultSourceEnum = typeof PromptReadResultSourceEnum[keyof typeof PromptReadResultSourceEnum];

/**
 * 
 * @export
 * @interface PromptReadResultInput
 */
export interface PromptReadResultInput {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    requestedLocale: string;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    sourceScope: PromptScopeInput;
    /**
     * 
     */
    source: PromptReadResultInputSourceEnum;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    sourceRevision?: number;
    /**
     * 
     */
    digest: string;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    latestRevision: number;
    /**
     * 
     */
    activeRevision: number | null;
}


/**
 * @export
 */
export const PromptReadResultInputSourceEnum = {
    Program: 'program',
    Override: 'override',
} as const;
export type PromptReadResultInputSourceEnum = typeof PromptReadResultInputSourceEnum[keyof typeof PromptReadResultInputSourceEnum];

/**
 * 
 * @export
 * @interface PromptRenderRequest
 */
export interface PromptRenderRequest {
    /**
     * 
     */
    snapshot: PromptSnapshotRef;
    /**
     * 
     */
    params: JsonValue | null;
}
/**
 * 
 * @export
 * @interface PromptRenderRequestInput
 */
export interface PromptRenderRequestInput {
    /**
     * 
     */
    snapshot: PromptSnapshotRefInput;
    /**
     * 
     */
    params: JsonValueInput | null;
}
/**
 * 
 * @export
 * @interface PromptRenderResult
 */
export interface PromptRenderResult {
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    bytes: number;
    /**
     * 
     */
    snapshot: PromptSnapshot;
}
/**
 * 
 * @export
 * @interface PromptRenderResultInput
 */
export interface PromptRenderResultInput {
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    bytes: number;
    /**
     * 
     */
    snapshot: PromptSnapshotInput;
}
/**
 * 
 * @export
 * @interface PromptResetRequest
 */
export interface PromptResetRequest {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface PromptResetRequestInput
 */
export interface PromptResetRequestInput {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface PromptRevision
 */
export interface PromptRevision {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    digest: string;
    /**
     * 
     */
    paramsSchemaRevision: string;
    /**
     * 
     */
    reason: string | null;
    /**
     * 
     */
    recordedAt: string;
}
/**
 * 
 * @export
 * @interface PromptRevisionInput
 */
export interface PromptRevisionInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    digest: string;
    /**
     * 
     */
    paramsSchemaRevision: string;
    /**
     * 
     */
    reason: string | null;
    /**
     * 
     */
    recordedAt: string;
}
/**
 * 
 * @export
 * @interface PromptSaveRequest
 */
export interface PromptSaveRequest {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    reason?: string;
}
/**
 * 
 * @export
 * @interface PromptSaveRequestInput
 */
export interface PromptSaveRequestInput {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    text: string;
    /**
     * 
     */
    reason?: string;
}
/**
 * @type PromptScope
 * 
 * @export
 */
export type PromptScope = ConfigScopeOneOf | PromptScopeInputOneOf;
/**
 * @type PromptScopeInput
 * 
 * @export
 */
export type PromptScopeInput = ConfigScopeInputOneOf1 | PromptScopeInputOneOf;
/**
 * 
 * @export
 * @interface PromptScopeInputOneOf
 */
export interface PromptScopeInputOneOf {
    /**
     * 
     */
    kind: PromptScopeInputOneOfKindEnum;
    /**
     * 
     */
    installationId: string;
}


/**
 * @export
 */
export const PromptScopeInputOneOfKindEnum = {
    Installation: 'installation',
} as const;
export type PromptScopeInputOneOfKindEnum = typeof PromptScopeInputOneOfKindEnum[keyof typeof PromptScopeInputOneOfKindEnum];

/**
 * 
 * @export
 * @interface PromptSnapshot
 */
export interface PromptSnapshot {
    /**
     * 
     */
    ref: PromptSnapshotRef;
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    sourceScope: PromptScope;
    /**
     * 
     */
    source: PromptSnapshotSourceEnum;
    /**
     * 
     */
    revision?: number;
    /**
     * 
     */
    catalogRevision: string;
    /**
     * 
     */
    paramsSchemaRevision: string;
    /**
     * 
     */
    dependencies: Array<PromptSnapshotDependenciesInner>;
    /**
     * 
     */
    engine: PromptSnapshotInputEngine;
}


/**
 * @export
 */
export const PromptSnapshotSourceEnum = {
    Program: 'program',
    Override: 'override',
} as const;
export type PromptSnapshotSourceEnum = typeof PromptSnapshotSourceEnum[keyof typeof PromptSnapshotSourceEnum];

/**
 * 
 * @export
 * @interface PromptSnapshotDependenciesInner
 */
export interface PromptSnapshotDependenciesInner {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    source: PromptSnapshotDependenciesInnerSourceEnum;
    /**
     * 
     */
    scope: PromptScope;
    /**
     * 
     */
    revision?: number;
    /**
     * 
     */
    digest: string;
}


/**
 * @export
 */
export const PromptSnapshotDependenciesInnerSourceEnum = {
    Program: 'program',
    Override: 'override',
} as const;
export type PromptSnapshotDependenciesInnerSourceEnum = typeof PromptSnapshotDependenciesInnerSourceEnum[keyof typeof PromptSnapshotDependenciesInnerSourceEnum];

/**
 * 
 * @export
 * @interface PromptSnapshotInput
 */
export interface PromptSnapshotInput {
    /**
     * 
     */
    ref: PromptSnapshotRefInput;
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    sourceScope: PromptScopeInput;
    /**
     * 
     */
    source: PromptSnapshotInputSourceEnum;
    /**
     * 
     */
    revision?: number;
    /**
     * 
     */
    catalogRevision: string;
    /**
     * 
     */
    paramsSchemaRevision: string;
    /**
     * 
     */
    dependencies: Array<PromptSnapshotInputDependenciesInner>;
    /**
     * 
     */
    engine: PromptSnapshotInputEngine;
}


/**
 * @export
 */
export const PromptSnapshotInputSourceEnum = {
    Program: 'program',
    Override: 'override',
} as const;
export type PromptSnapshotInputSourceEnum = typeof PromptSnapshotInputSourceEnum[keyof typeof PromptSnapshotInputSourceEnum];

/**
 * 
 * @export
 * @interface PromptSnapshotInputDependenciesInner
 */
export interface PromptSnapshotInputDependenciesInner {
    /**
     * 
     */
    promptId: string;
    /**
     * 
     */
    locale: string;
    /**
     * 
     */
    source: PromptSnapshotInputDependenciesInnerSourceEnum;
    /**
     * 
     */
    scope: PromptScopeInput;
    /**
     * 
     */
    revision?: number;
    /**
     * 
     */
    digest: string;
}


/**
 * @export
 */
export const PromptSnapshotInputDependenciesInnerSourceEnum = {
    Program: 'program',
    Override: 'override',
} as const;
export type PromptSnapshotInputDependenciesInnerSourceEnum = typeof PromptSnapshotInputDependenciesInnerSourceEnum[keyof typeof PromptSnapshotInputDependenciesInnerSourceEnum];

/**
 * 
 * @export
 * @interface PromptSnapshotInputEngine
 */
export interface PromptSnapshotInputEngine {
    /**
     * 
     */
    name: PromptSnapshotInputEngineNameEnum;
    /**
     * 
     */
    version: string;
    /**
     * 
     */
    optionsDigest: string;
}


/**
 * @export
 */
export const PromptSnapshotInputEngineNameEnum = {
    Liquidjs: 'liquidjs',
} as const;
export type PromptSnapshotInputEngineNameEnum = typeof PromptSnapshotInputEngineNameEnum[keyof typeof PromptSnapshotInputEngineNameEnum];

/**
 * 
 * @export
 * @interface PromptSnapshotRef
 */
export interface PromptSnapshotRef {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    digest: string;
}
/**
 * 
 * @export
 * @interface PromptSnapshotRefInput
 */
export interface PromptSnapshotRefInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    digest: string;
}
/**
 * 
 * @export
 * @interface PromptSnapshotRequest
 */
export interface PromptSnapshotRequest {
    /**
     * 
     */
    binding: PromptBinding;
    /**
     * 
     */
    scope: PromptScope;
}
/**
 * 
 * @export
 * @interface PromptSnapshotRequestInput
 */
export interface PromptSnapshotRequestInput {
    /**
     * 
     */
    binding: PromptBindingInput;
    /**
     * 
     */
    scope: PromptScopeInput;
}
/**
 * 
 * @export
 * @interface ProviderDefinition
 */
export interface ProviderDefinition {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    adapter: string;
    /**
     * 
     */
    baseURL?: string;
    /**
     * 
     */
    credentialRef?: string;
    /**
     * 
     */
    networkProfileId: string;
    /**
     * 
     */
    options: { [key: string]: JsonValue; };
    /**
     * 
     */
    enabled: boolean;
}
/**
 * 
 * @export
 * @interface ProviderDefinitionInput
 */
export interface ProviderDefinitionInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    adapter: string;
    /**
     * 
     */
    baseURL?: string;
    /**
     * 
     */
    credentialRef?: string;
    /**
     * 
     */
    networkProfileId: string;
    /**
     * 
     */
    options: { [key: string]: JsonValueInput; };
    /**
     * 
     */
    enabled: boolean;
}
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
    reviewAt?: TimePointRequestInput;
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
 * @interface Query
 */
export interface Query {
    /**
     * 
     */
    intent: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    kinds?: Array<KnowledgeKind>;
    /**
     * 
     */
    entities: Array<string>;
    /**
     * 
     */
    entityMatch: QueryEntityMatchEnum;
    /**
     * 
     */
    concepts: Array<string>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    tagMatch: QueryTagMatchEnum;
    /**
     * 
     */
    time?: QueryTime;
    /**
     * 
     */
    knowledgeAt?: TimePointRequest;
    /**
     * 
     */
    recordedAsOf?: any;
    /**
     * 
     */
    refs: Array<string>;
    /**
     * 
     */
    sources: Array<string>;
    /**
     * 
     */
    preferences: Array<QueryPreferencesEnum>;
    /**
     * 
     */
    exploration: number;
    /**
     * 
     */
    residual: boolean;
    /**
     * 
     */
    expand: Array<QueryExpandEnum>;
    /**
     * 
     */
    limit: number;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    workContextId?: string;
}


/**
 * @export
 */
export const QueryEntityMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type QueryEntityMatchEnum = typeof QueryEntityMatchEnum[keyof typeof QueryEntityMatchEnum];

/**
 * @export
 */
export const QueryTagMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type QueryTagMatchEnum = typeof QueryTagMatchEnum[keyof typeof QueryTagMatchEnum];

/**
 * @export
 */
export const QueryPreferencesEnum = {
    Recent: 'recent',
    IndependentSources: 'independent_sources',
    Diverse: 'diverse',
} as const;
export type QueryPreferencesEnum = typeof QueryPreferencesEnum[keyof typeof QueryPreferencesEnum];

/**
 * @export
 */
export const QueryExpandEnum = {
    Sources: 'sources',
    Relations: 'relations',
} as const;
export type QueryExpandEnum = typeof QueryExpandEnum[keyof typeof QueryExpandEnum];

/**
 * 
 * @export
 * @interface QueryInput
 */
export interface QueryInput {
    /**
     * 
     */
    intent?: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    kinds?: Array<KnowledgeKindInput>;
    /**
     * 
     */
    entities?: Array<string>;
    /**
     * 
     */
    entityMatch?: QueryInputEntityMatchEnum;
    /**
     * 
     */
    concepts?: Array<string>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    tagMatch?: QueryInputTagMatchEnum;
    /**
     * 
     */
    time?: QueryInputTime;
    /**
     * 
     */
    knowledgeAt?: TimePointRequestInput;
    /**
     * 
     */
    recordedAsOf?: string;
    /**
     * 
     */
    refs?: Array<string>;
    /**
     * 
     */
    sources?: Array<string>;
    /**
     * 
     */
    preferences?: Array<QueryInputPreferencesEnum>;
    /**
     * 
     */
    exploration?: number;
    /**
     * 
     */
    residual?: boolean;
    /**
     * 
     */
    expand?: Array<QueryInputExpandEnum>;
    /**
     * 
     */
    limit?: number;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    workContextId?: string;
}


/**
 * @export
 */
export const QueryInputEntityMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type QueryInputEntityMatchEnum = typeof QueryInputEntityMatchEnum[keyof typeof QueryInputEntityMatchEnum];

/**
 * @export
 */
export const QueryInputTagMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type QueryInputTagMatchEnum = typeof QueryInputTagMatchEnum[keyof typeof QueryInputTagMatchEnum];

/**
 * @export
 */
export const QueryInputPreferencesEnum = {
    Recent: 'recent',
    IndependentSources: 'independent_sources',
    Diverse: 'diverse',
} as const;
export type QueryInputPreferencesEnum = typeof QueryInputPreferencesEnum[keyof typeof QueryInputPreferencesEnum];

/**
 * @export
 */
export const QueryInputExpandEnum = {
    Sources: 'sources',
    Relations: 'relations',
} as const;
export type QueryInputExpandEnum = typeof QueryInputExpandEnum[keyof typeof QueryInputExpandEnum];

/**
 * 
 * @export
 * @interface QueryInputTime
 */
export interface QueryInputTime {
    /**
     * 
     */
    field: QueryInputTimeFieldEnum;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    start: string;
    /**
     * 
     */
    end: string;
}


/**
 * @export
 */
export const QueryInputTimeFieldEnum = {
    Occurred: 'occurred',
    Observed: 'observed',
    Formed: 'formed',
    Valid: 'valid',
    Recorded: 'recorded',
} as const;
export type QueryInputTimeFieldEnum = typeof QueryInputTimeFieldEnum[keyof typeof QueryInputTimeFieldEnum];

/**
 * 
 * @export
 * @interface QueryItem
 */
export interface QueryItem {
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    excerpt: string;
    /**
     * 
     */
    formation: string;
    /**
     * 
     */
    stance: string;
    /**
     * 
     */
    confidence?: number;
    /**
     * 
     */
    time: QueryItemTime;
    /**
     * 
     */
    sourceRefs: Array<Ref>;
    /**
     * 
     */
    matchReasons: Array<string>;
    /**
     * 
     */
    relatedRefs?: Array<Ref>;
}
/**
 * 
 * @export
 * @interface QueryItemInput
 */
export interface QueryItemInput {
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    excerpt: string;
    /**
     * 
     */
    formation: string;
    /**
     * 
     */
    stance: string;
    /**
     * 
     */
    confidence?: number;
    /**
     * 
     */
    time: QueryItemInputTime;
    /**
     * 
     */
    sourceRefs: Array<RefInput>;
    /**
     * 
     */
    matchReasons: Array<string>;
    /**
     * 
     */
    relatedRefs?: Array<RefInput>;
}
/**
 * 
 * @export
 * @interface QueryItemInputTime
 */
export interface QueryItemInputTime {
    /**
     * 
     */
    formed: TimePointInput;
    /**
     * 
     */
    valid?: TimeRangeInput;
    /**
     * 
     */
    recorded: TimePointInput;
}
/**
 * 
 * @export
 * @interface QueryItemTime
 */
export interface QueryItemTime {
    /**
     * 
     */
    formed: TimePoint;
    /**
     * 
     */
    valid?: TimeRange;
    /**
     * 
     */
    recorded: TimePoint;
}
/**
 * 
 * @export
 * @interface QueryRequest
 */
export interface QueryRequest {
    /**
     * 
     */
    intent: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    kinds?: Array<KnowledgeKind>;
    /**
     * 
     */
    entities: Array<string>;
    /**
     * 
     */
    entityMatch: QueryRequestEntityMatchEnum;
    /**
     * 
     */
    concepts: Array<string>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    tagMatch: QueryRequestTagMatchEnum;
    /**
     * 
     */
    time?: QueryTime;
    /**
     * 
     */
    knowledgeAt?: TimePointRequest;
    /**
     * 
     */
    recordedAsOf?: any;
    /**
     * 
     */
    refs: Array<string>;
    /**
     * 
     */
    sources: Array<string>;
    /**
     * 
     */
    preferences: Array<QueryRequestPreferencesEnum>;
    /**
     * 
     */
    exploration: number;
    /**
     * 
     */
    residual: boolean;
    /**
     * 
     */
    expand: Array<QueryRequestExpandEnum>;
    /**
     * 
     */
    limit: number;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    workContextId?: string;
}


/**
 * @export
 */
export const QueryRequestEntityMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type QueryRequestEntityMatchEnum = typeof QueryRequestEntityMatchEnum[keyof typeof QueryRequestEntityMatchEnum];

/**
 * @export
 */
export const QueryRequestTagMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type QueryRequestTagMatchEnum = typeof QueryRequestTagMatchEnum[keyof typeof QueryRequestTagMatchEnum];

/**
 * @export
 */
export const QueryRequestPreferencesEnum = {
    Recent: 'recent',
    IndependentSources: 'independent_sources',
    Diverse: 'diverse',
} as const;
export type QueryRequestPreferencesEnum = typeof QueryRequestPreferencesEnum[keyof typeof QueryRequestPreferencesEnum];

/**
 * @export
 */
export const QueryRequestExpandEnum = {
    Sources: 'sources',
    Relations: 'relations',
} as const;
export type QueryRequestExpandEnum = typeof QueryRequestExpandEnum[keyof typeof QueryRequestExpandEnum];

/**
 * 
 * @export
 * @interface QueryRequestInput
 */
export interface QueryRequestInput {
    /**
     * 
     */
    intent?: string;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    kinds?: Array<KnowledgeKindInput>;
    /**
     * 
     */
    entities?: Array<string>;
    /**
     * 
     */
    entityMatch?: QueryRequestInputEntityMatchEnum;
    /**
     * 
     */
    concepts?: Array<string>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    tagMatch?: QueryRequestInputTagMatchEnum;
    /**
     * 
     */
    time?: QueryInputTime;
    /**
     * 
     */
    knowledgeAt?: TimePointRequestInput;
    /**
     * 
     */
    recordedAsOf?: string;
    /**
     * 
     */
    refs?: Array<string>;
    /**
     * 
     */
    sources?: Array<string>;
    /**
     * 
     */
    preferences?: Array<QueryRequestInputPreferencesEnum>;
    /**
     * 
     */
    exploration?: number;
    /**
     * 
     */
    residual?: boolean;
    /**
     * 
     */
    expand?: Array<QueryRequestInputExpandEnum>;
    /**
     * 
     */
    limit?: number;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    workContextId?: string;
}


/**
 * @export
 */
export const QueryRequestInputEntityMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type QueryRequestInputEntityMatchEnum = typeof QueryRequestInputEntityMatchEnum[keyof typeof QueryRequestInputEntityMatchEnum];

/**
 * @export
 */
export const QueryRequestInputTagMatchEnum = {
    Any: 'any',
    All: 'all',
} as const;
export type QueryRequestInputTagMatchEnum = typeof QueryRequestInputTagMatchEnum[keyof typeof QueryRequestInputTagMatchEnum];

/**
 * @export
 */
export const QueryRequestInputPreferencesEnum = {
    Recent: 'recent',
    IndependentSources: 'independent_sources',
    Diverse: 'diverse',
} as const;
export type QueryRequestInputPreferencesEnum = typeof QueryRequestInputPreferencesEnum[keyof typeof QueryRequestInputPreferencesEnum];

/**
 * @export
 */
export const QueryRequestInputExpandEnum = {
    Sources: 'sources',
    Relations: 'relations',
} as const;
export type QueryRequestInputExpandEnum = typeof QueryRequestInputExpandEnum[keyof typeof QueryRequestInputExpandEnum];

/**
 * 
 * @export
 * @interface QueryResult
 */
export interface QueryResult {
    /**
     * 
     */
    items: Array<QueryItem>;
    /**
     * 
     */
    resolvedQuery: Query;
    /**
     * 
     */
    nextCursor?: string;
    /**
     * 
     */
    resultSetId: string;
    /**
     * 
     */
    indexState: QueryResultIndexState;
}
/**
 * 
 * @export
 * @interface QueryResultIndexState
 */
export interface QueryResultIndexState {
    /**
     * 
     */
    textReady: boolean;
    /**
     * 
     */
    vectorReady: boolean;
    /**
     * 
     */
    embeddingSpace?: string;
    /**
     * 
     */
    tokenizer: QueryResultIndexStateTokenizerEnum;
    /**
     * 
     */
    selectedRevisions: number;
    /**
     * 
     */
    historical: boolean;
}


/**
 * @export
 */
export const QueryResultIndexStateTokenizerEnum = {
    Icu: 'icu',
} as const;
export type QueryResultIndexStateTokenizerEnum = typeof QueryResultIndexStateTokenizerEnum[keyof typeof QueryResultIndexStateTokenizerEnum];

/**
 * 
 * @export
 * @interface QueryResultInput
 */
export interface QueryResultInput {
    /**
     * 
     */
    items: Array<QueryItemInput>;
    /**
     * 
     */
    resolvedQuery: QueryInput;
    /**
     * 
     */
    nextCursor?: string;
    /**
     * 
     */
    resultSetId: string;
    /**
     * 
     */
    indexState: QueryResultInputIndexState;
}
/**
 * 
 * @export
 * @interface QueryResultInputIndexState
 */
export interface QueryResultInputIndexState {
    /**
     * 
     */
    textReady: boolean;
    /**
     * 
     */
    vectorReady: boolean;
    /**
     * 
     */
    embeddingSpace?: string;
    /**
     * 
     */
    tokenizer: QueryResultInputIndexStateTokenizerEnum;
    /**
     * 
     */
    selectedRevisions: number;
    /**
     * 
     */
    historical: boolean;
}


/**
 * @export
 */
export const QueryResultInputIndexStateTokenizerEnum = {
    Icu: 'icu',
} as const;
export type QueryResultInputIndexStateTokenizerEnum = typeof QueryResultInputIndexStateTokenizerEnum[keyof typeof QueryResultInputIndexStateTokenizerEnum];

/**
 * 
 * @export
 * @interface QueryTime
 */
export interface QueryTime {
    /**
     * 
     */
    field: QueryTimeFieldEnum;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    start: any;
    /**
     * 
     */
    end: any;
}


/**
 * @export
 */
export const QueryTimeFieldEnum = {
    Occurred: 'occurred',
    Observed: 'observed',
    Formed: 'formed',
    Valid: 'valid',
    Recorded: 'recorded',
} as const;
export type QueryTimeFieldEnum = typeof QueryTimeFieldEnum[keyof typeof QueryTimeFieldEnum];


/**
 * 
 * @export
 */
export const Reasoning = {
    ProviderDefault: 'provider-default',
    None: 'none',
    Minimal: 'minimal',
    Low: 'low',
    Medium: 'medium',
    High: 'high',
    Xhigh: 'xhigh',
    Max: 'max',
} as const;
export type Reasoning = typeof Reasoning[keyof typeof Reasoning];


/**
 * 
 * @export
 */
export const ReasoningInput = {
    ProviderDefault: 'provider-default',
    None: 'none',
    Minimal: 'minimal',
    Low: 'low',
    Medium: 'medium',
    High: 'high',
    Xhigh: 'xhigh',
    Max: 'max',
} as const;
export type ReasoningInput = typeof ReasoningInput[keyof typeof ReasoningInput];

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
 * @interface RelationPage
 */
export interface RelationPage {
    /**
     * 
     */
    items: Array<ObjectRelation>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface RelationPageInput
 */
export interface RelationPageInput {
    /**
     * 
     */
    items: Array<ObjectRelationInput>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface RelationRead
 */
export interface RelationRead {
    /**
     * 
     */
    knowledgeAt?: TimePointRequest;
    /**
     * 
     */
    recordedAsOf?: any;
    /**
     * 
     */
    limit: number;
    /**
     * 
     */
    cursor?: string;
}
/**
 * 
 * @export
 * @interface RelationReadInput
 */
export interface RelationReadInput {
    /**
     * 
     */
    knowledgeAt?: TimePointRequestInput;
    /**
     * 
     */
    recordedAsOf?: string;
    /**
     * 
     */
    limit?: number;
    /**
     * 
     */
    cursor?: string;
}
/**
 * 
 * @export
 * @interface RelationWrite
 */
export interface RelationWrite {
    /**
     * 
     */
    fromId: string;
    /**
     * 
     */
    toId: string;
    /**
     * 
     */
    relation: string;
    /**
     * 
     */
    weight: number;
    /**
     * 
     */
    evidenceRefs: Array<Ref>;
    /**
     * 
     */
    formed: TimePointRequest;
    /**
     * 
     */
    valid?: TimeRangeRequest;
}
/**
 * 
 * @export
 * @interface RelationWriteInput
 */
export interface RelationWriteInput {
    /**
     * 
     */
    fromId: string;
    /**
     * 
     */
    toId: string;
    /**
     * 
     */
    relation: string;
    /**
     * 
     */
    weight?: number;
    /**
     * 
     */
    evidenceRefs: Array<RefInput>;
    /**
     * 
     */
    formed: TimePointRequestInput;
    /**
     * 
     */
    valid?: TimeRangeRequestInput;
}
/**
 * @type ResourceBody
 * 
 * @export
 */
export type ResourceBody = ResourceBodyOneOf | ResourceBodyOneOf1 | ResourceBodyOneOf2;
/**
 * @type ResourceBodyInput
 * 
 * @export
 */
export type ResourceBodyInput = ResourceBodyInputOneOf | ResourceBodyInputOneOf1 | ResourceBodyInputOneOf2;
/**
 * 
 * @export
 * @interface ResourceBodyInputOneOf
 */
export interface ResourceBodyInputOneOf {
    /**
     * 
     */
    kind: ResourceBodyInputOneOfKindEnum;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    root: string;
    /**
     * 
     */
    extensions?: Array<string>;
    /**
     * 
     */
    maxBytes?: number;
    /**
     * 
     */
    policy: PolicyInput;
}


/**
 * @export
 */
export const ResourceBodyInputOneOfKindEnum = {
    Directory: 'directory',
} as const;
export type ResourceBodyInputOneOfKindEnum = typeof ResourceBodyInputOneOfKindEnum[keyof typeof ResourceBodyInputOneOfKindEnum];

/**
 * 
 * @export
 * @interface ResourceBodyInputOneOf1
 */
export interface ResourceBodyInputOneOf1 {
    /**
     * 
     */
    kind: ResourceBodyInputOneOf1KindEnum;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    baseUrl: string;
    /**
     * 
     */
    allowedOrigins?: Array<string>;
    /**
     * 
     */
    maxBytes?: number;
    /**
     * 
     */
    policy: PolicyInput;
}


/**
 * @export
 */
export const ResourceBodyInputOneOf1KindEnum = {
    Http: 'http',
} as const;
export type ResourceBodyInputOneOf1KindEnum = typeof ResourceBodyInputOneOf1KindEnum[keyof typeof ResourceBodyInputOneOf1KindEnum];

/**
 * 
 * @export
 * @interface ResourceBodyInputOneOf2
 */
export interface ResourceBodyInputOneOf2 {
    /**
     * 
     */
    kind: ResourceBodyInputOneOf2KindEnum;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    connectorId: string;
    /**
     * 
     */
    allowedUris?: Array<string>;
    /**
     * 
     */
    maxBytes?: number;
    /**
     * 
     */
    policy: PolicyInput;
}


/**
 * @export
 */
export const ResourceBodyInputOneOf2KindEnum = {
    Mcp: 'mcp',
} as const;
export type ResourceBodyInputOneOf2KindEnum = typeof ResourceBodyInputOneOf2KindEnum[keyof typeof ResourceBodyInputOneOf2KindEnum];

/**
 * 
 * @export
 * @interface ResourceBodyOneOf
 */
export interface ResourceBodyOneOf {
    /**
     * 
     */
    kind: ResourceBodyOneOfKindEnum;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    root: string;
    /**
     * 
     */
    extensions: Array<string>;
    /**
     * 
     */
    maxBytes: number;
    /**
     * 
     */
    policy: Policy;
}


/**
 * @export
 */
export const ResourceBodyOneOfKindEnum = {
    Directory: 'directory',
} as const;
export type ResourceBodyOneOfKindEnum = typeof ResourceBodyOneOfKindEnum[keyof typeof ResourceBodyOneOfKindEnum];

/**
 * 
 * @export
 * @interface ResourceBodyOneOf1
 */
export interface ResourceBodyOneOf1 {
    /**
     * 
     */
    kind: ResourceBodyOneOf1KindEnum;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    baseUrl: string;
    /**
     * 
     */
    allowedOrigins: Array<string>;
    /**
     * 
     */
    maxBytes: number;
    /**
     * 
     */
    policy: Policy;
}


/**
 * @export
 */
export const ResourceBodyOneOf1KindEnum = {
    Http: 'http',
} as const;
export type ResourceBodyOneOf1KindEnum = typeof ResourceBodyOneOf1KindEnum[keyof typeof ResourceBodyOneOf1KindEnum];

/**
 * 
 * @export
 * @interface ResourceBodyOneOf2
 */
export interface ResourceBodyOneOf2 {
    /**
     * 
     */
    kind: ResourceBodyOneOf2KindEnum;
    /**
     * 
     */
    title: string;
    /**
     * 
     */
    connectorId: string;
    /**
     * 
     */
    allowedUris: Array<string>;
    /**
     * 
     */
    maxBytes: number;
    /**
     * 
     */
    policy: Policy;
}


/**
 * @export
 */
export const ResourceBodyOneOf2KindEnum = {
    Mcp: 'mcp',
} as const;
export type ResourceBodyOneOf2KindEnum = typeof ResourceBodyOneOf2KindEnum[keyof typeof ResourceBodyOneOf2KindEnum];

/**
 * 
 * @export
 * @interface ResourceRef
 */
export interface ResourceRef {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface ResourceRefInput
 */
export interface ResourceRefInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface RevisionRef
 */
export interface RevisionRef {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface RevisionRefInput
 */
export interface RevisionRefInput {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    revision: number;
}
/**
 * @type RolePolicy
 * 
 * @export
 */
export type RolePolicy = RolePolicyOneOf | RolePolicyOneOf1 | RolePolicyOneOf2 | RolePolicyOneOf3 | RolePolicyOneOf4;
/**
 * @type RolePolicyInput
 * 
 * @export
 */
export type RolePolicyInput = RolePolicyInputOneOf | RolePolicyInputOneOf1 | RolePolicyInputOneOf2 | RolePolicyInputOneOf3 | RolePolicyInputOneOf4;
/**
 * 
 * @export
 * @interface RolePolicyInputOneOf
 */
export interface RolePolicyInputOneOf {
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    resources: Array<ResourceRefInput>;
    /**
     * 
     */
    selection: ModelSelectionInput;
    /**
     * 
     */
    timeoutMs: number;
    /**
     * 
     */
    budgetPolicyRef?: string;
    /**
     * 
     */
    prompt?: PromptBindingInput;
    /**
     * 
     */
    kind: RolePolicyInputOneOfKindEnum;
    /**
     * 
     */
    inference: LanguageSettingsInput;
}


/**
 * @export
 */
export const RolePolicyInputOneOfKindEnum = {
    Language: 'language',
} as const;
export type RolePolicyInputOneOfKindEnum = typeof RolePolicyInputOneOfKindEnum[keyof typeof RolePolicyInputOneOfKindEnum];

/**
 * 
 * @export
 * @interface RolePolicyInputOneOf1
 */
export interface RolePolicyInputOneOf1 {
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    resources: Array<ResourceRefInput>;
    /**
     * 
     */
    selection: ModelSelectionInput;
    /**
     * 
     */
    timeoutMs: number;
    /**
     * 
     */
    budgetPolicyRef?: string;
    /**
     * 
     */
    prompt?: PromptBindingInput;
    /**
     * 
     */
    kind: RolePolicyInputOneOf1KindEnum;
    /**
     * 
     */
    inference: RolePolicyInputOneOf1Inference;
}


/**
 * @export
 */
export const RolePolicyInputOneOf1KindEnum = {
    Embedding: 'embedding',
} as const;
export type RolePolicyInputOneOf1KindEnum = typeof RolePolicyInputOneOf1KindEnum[keyof typeof RolePolicyInputOneOf1KindEnum];

/**
 * 
 * @export
 * @interface RolePolicyInputOneOf1Inference
 */
export interface RolePolicyInputOneOf1Inference {
    /**
     * 
     */
    maxParallelCalls: number;
    /**
     * 
     */
    providerOptions: { [key: string]: { [key: string]: JsonValueInput; }; };
}
/**
 * 
 * @export
 * @interface RolePolicyInputOneOf2
 */
export interface RolePolicyInputOneOf2 {
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    resources: Array<ResourceRefInput>;
    /**
     * 
     */
    selection: ModelSelectionInput;
    /**
     * 
     */
    timeoutMs: number;
    /**
     * 
     */
    budgetPolicyRef?: string;
    /**
     * 
     */
    prompt?: PromptBindingInput;
    /**
     * 
     */
    kind: RolePolicyInputOneOf2KindEnum;
    /**
     * 
     */
    inference: RolePolicyInputOneOf2Inference;
}


/**
 * @export
 */
export const RolePolicyInputOneOf2KindEnum = {
    Reranking: 'reranking',
} as const;
export type RolePolicyInputOneOf2KindEnum = typeof RolePolicyInputOneOf2KindEnum[keyof typeof RolePolicyInputOneOf2KindEnum];

/**
 * 
 * @export
 * @interface RolePolicyInputOneOf2Inference
 */
export interface RolePolicyInputOneOf2Inference {
    /**
     * 
     */
    topN?: number;
    /**
     * 
     */
    providerOptions: { [key: string]: { [key: string]: JsonValueInput; }; };
}
/**
 * 
 * @export
 * @interface RolePolicyInputOneOf3
 */
export interface RolePolicyInputOneOf3 {
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    resources: Array<ResourceRefInput>;
    /**
     * 
     */
    selection: ModelSelectionInput;
    /**
     * 
     */
    timeoutMs: number;
    /**
     * 
     */
    budgetPolicyRef?: string;
    /**
     * 
     */
    prompt?: PromptBindingInput;
    /**
     * 
     */
    kind: RolePolicyInputOneOf3KindEnum;
    /**
     * 
     */
    inference: RolePolicyInputOneOf3Inference;
}


/**
 * @export
 */
export const RolePolicyInputOneOf3KindEnum = {
    Transcription: 'transcription',
} as const;
export type RolePolicyInputOneOf3KindEnum = typeof RolePolicyInputOneOf3KindEnum[keyof typeof RolePolicyInputOneOf3KindEnum];

/**
 * 
 * @export
 * @interface RolePolicyInputOneOf3Inference
 */
export interface RolePolicyInputOneOf3Inference {
    /**
     * 
     */
    providerOptions: { [key: string]: { [key: string]: JsonValueInput; }; };
}
/**
 * 
 * @export
 * @interface RolePolicyInputOneOf4
 */
export interface RolePolicyInputOneOf4 {
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    resources: Array<ResourceRefInput>;
    /**
     * 
     */
    selection: ModelSelectionInput;
    /**
     * 
     */
    timeoutMs: number;
    /**
     * 
     */
    budgetPolicyRef?: string;
    /**
     * 
     */
    prompt?: PromptBindingInput;
    /**
     * 
     */
    kind: RolePolicyInputOneOf4KindEnum;
    /**
     * 
     */
    inference: RolePolicyInputOneOf4Inference;
}


/**
 * @export
 */
export const RolePolicyInputOneOf4KindEnum = {
    Speech: 'speech',
} as const;
export type RolePolicyInputOneOf4KindEnum = typeof RolePolicyInputOneOf4KindEnum[keyof typeof RolePolicyInputOneOf4KindEnum];

/**
 * 
 * @export
 * @interface RolePolicyInputOneOf4Inference
 */
export interface RolePolicyInputOneOf4Inference {
    /**
     * 
     */
    voice?: string;
    /**
     * 
     */
    outputFormat?: string;
    /**
     * 
     */
    speed?: number;
    /**
     * 
     */
    language?: string;
    /**
     * 
     */
    providerOptions: { [key: string]: { [key: string]: JsonValueInput; }; };
}
/**
 * 
 * @export
 * @interface RolePolicyOneOf
 */
export interface RolePolicyOneOf {
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    resources: Array<ResourceRef>;
    /**
     * 
     */
    selection: ModelSelection;
    /**
     * 
     */
    timeoutMs: number;
    /**
     * 
     */
    budgetPolicyRef?: string;
    /**
     * 
     */
    prompt?: PromptBinding;
    /**
     * 
     */
    kind: RolePolicyOneOfKindEnum;
    /**
     * 
     */
    inference: LanguageSettings;
}


/**
 * @export
 */
export const RolePolicyOneOfKindEnum = {
    Language: 'language',
} as const;
export type RolePolicyOneOfKindEnum = typeof RolePolicyOneOfKindEnum[keyof typeof RolePolicyOneOfKindEnum];

/**
 * 
 * @export
 * @interface RolePolicyOneOf1
 */
export interface RolePolicyOneOf1 {
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    resources: Array<ResourceRef>;
    /**
     * 
     */
    selection: ModelSelection;
    /**
     * 
     */
    timeoutMs: number;
    /**
     * 
     */
    budgetPolicyRef?: string;
    /**
     * 
     */
    prompt?: PromptBinding;
    /**
     * 
     */
    kind: RolePolicyOneOf1KindEnum;
    /**
     * 
     */
    inference: RolePolicyOneOf1Inference;
}


/**
 * @export
 */
export const RolePolicyOneOf1KindEnum = {
    Embedding: 'embedding',
} as const;
export type RolePolicyOneOf1KindEnum = typeof RolePolicyOneOf1KindEnum[keyof typeof RolePolicyOneOf1KindEnum];

/**
 * 
 * @export
 * @interface RolePolicyOneOf1Inference
 */
export interface RolePolicyOneOf1Inference {
    /**
     * 
     */
    maxParallelCalls: number;
    /**
     * 
     */
    providerOptions: { [key: string]: { [key: string]: JsonValue; }; };
}
/**
 * 
 * @export
 * @interface RolePolicyOneOf2
 */
export interface RolePolicyOneOf2 {
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    resources: Array<ResourceRef>;
    /**
     * 
     */
    selection: ModelSelection;
    /**
     * 
     */
    timeoutMs: number;
    /**
     * 
     */
    budgetPolicyRef?: string;
    /**
     * 
     */
    prompt?: PromptBinding;
    /**
     * 
     */
    kind: RolePolicyOneOf2KindEnum;
    /**
     * 
     */
    inference: RolePolicyOneOf2Inference;
}


/**
 * @export
 */
export const RolePolicyOneOf2KindEnum = {
    Reranking: 'reranking',
} as const;
export type RolePolicyOneOf2KindEnum = typeof RolePolicyOneOf2KindEnum[keyof typeof RolePolicyOneOf2KindEnum];

/**
 * 
 * @export
 * @interface RolePolicyOneOf2Inference
 */
export interface RolePolicyOneOf2Inference {
    /**
     * 
     */
    topN?: number;
    /**
     * 
     */
    providerOptions: { [key: string]: { [key: string]: JsonValue; }; };
}
/**
 * 
 * @export
 * @interface RolePolicyOneOf3
 */
export interface RolePolicyOneOf3 {
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    resources: Array<ResourceRef>;
    /**
     * 
     */
    selection: ModelSelection;
    /**
     * 
     */
    timeoutMs: number;
    /**
     * 
     */
    budgetPolicyRef?: string;
    /**
     * 
     */
    prompt?: PromptBinding;
    /**
     * 
     */
    kind: RolePolicyOneOf3KindEnum;
    /**
     * 
     */
    inference: RolePolicyOneOf3Inference;
}


/**
 * @export
 */
export const RolePolicyOneOf3KindEnum = {
    Transcription: 'transcription',
} as const;
export type RolePolicyOneOf3KindEnum = typeof RolePolicyOneOf3KindEnum[keyof typeof RolePolicyOneOf3KindEnum];

/**
 * 
 * @export
 * @interface RolePolicyOneOf3Inference
 */
export interface RolePolicyOneOf3Inference {
    /**
     * 
     */
    providerOptions: { [key: string]: { [key: string]: JsonValue; }; };
}
/**
 * 
 * @export
 * @interface RolePolicyOneOf4
 */
export interface RolePolicyOneOf4 {
    /**
     * 
     */
    enabled: boolean;
    /**
     * 
     */
    resources: Array<ResourceRef>;
    /**
     * 
     */
    selection: ModelSelection;
    /**
     * 
     */
    timeoutMs: number;
    /**
     * 
     */
    budgetPolicyRef?: string;
    /**
     * 
     */
    prompt?: PromptBinding;
    /**
     * 
     */
    kind: RolePolicyOneOf4KindEnum;
    /**
     * 
     */
    inference: RolePolicyOneOf4Inference;
}


/**
 * @export
 */
export const RolePolicyOneOf4KindEnum = {
    Speech: 'speech',
} as const;
export type RolePolicyOneOf4KindEnum = typeof RolePolicyOneOf4KindEnum[keyof typeof RolePolicyOneOf4KindEnum];

/**
 * 
 * @export
 * @interface RolePolicyOneOf4Inference
 */
export interface RolePolicyOneOf4Inference {
    /**
     * 
     */
    voice?: string;
    /**
     * 
     */
    outputFormat?: string;
    /**
     * 
     */
    speed?: number;
    /**
     * 
     */
    language?: string;
    /**
     * 
     */
    providerOptions: { [key: string]: { [key: string]: JsonValue; }; };
}
/**
 * 
 * @export
 * @interface SecretsCreate200Response
 */
export interface SecretsCreate200Response {
    /**
     * 
     */
    ref: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    generation: number;
    /**
     * 
     */
    state: SecretsCreate200ResponseStateEnum;
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    resourceRef: Ref;
    /**
     * 
     */
    allowedConsumers: Array<Consumer>;
    /**
     * 
     */
    backend: SecretsCreate200ResponseBackendEnum;
    /**
     * 
     */
    configured: boolean;
    /**
     * 
     */
    available: boolean;
    /**
     * 
     */
    createdAt: TimePoint;
    /**
     * 
     */
    replacedAt?: TimePoint;
    /**
     * 
     */
    revokedAt?: TimePoint;
    /**
     * 
     */
    cleanupPending: boolean;
    /**
     * 
     */
    externalRotationRequired: boolean;
}


/**
 * @export
 */
export const SecretsCreate200ResponseStateEnum = {
    Active: 'active',
    Revoked: 'revoked',
    Unavailable: 'unavailable',
} as const;
export type SecretsCreate200ResponseStateEnum = typeof SecretsCreate200ResponseStateEnum[keyof typeof SecretsCreate200ResponseStateEnum];

/**
 * @export
 */
export const SecretsCreate200ResponseBackendEnum = {
    Environment: 'environment',
    Os: 'os',
    ProtectedFile: 'protected_file',
} as const;
export type SecretsCreate200ResponseBackendEnum = typeof SecretsCreate200ResponseBackendEnum[keyof typeof SecretsCreate200ResponseBackendEnum];

/**
 * 
 * @export
 * @interface SecretsCreateRequest
 */
export interface SecretsCreateRequest {
    /**
     * 
     */
    purpose: string;
    /**
     * 
     */
    resourceRef: RefInput;
    /**
     * 
     */
    allowedConsumers: Array<ConsumerInput>;
    /**
     * 
     */
    backend: SecretsCreateRequestBackend;
}
/**
 * @type SecretsCreateRequestBackend
 * 
 * @export
 */
export type SecretsCreateRequestBackend = SecretsCreateRequestBackendOneOf | SecretsCreateRequestBackendOneOf1;
/**
 * 
 * @export
 * @interface SecretsCreateRequestBackendOneOf
 */
export interface SecretsCreateRequestBackendOneOf {
    /**
     * 
     */
    kind: SecretsCreateRequestBackendOneOfKindEnum;
    /**
     * 
     */
    variable: string;
}


/**
 * @export
 */
export const SecretsCreateRequestBackendOneOfKindEnum = {
    Environment: 'environment',
} as const;
export type SecretsCreateRequestBackendOneOfKindEnum = typeof SecretsCreateRequestBackendOneOfKindEnum[keyof typeof SecretsCreateRequestBackendOneOfKindEnum];

/**
 * 
 * @export
 * @interface SecretsCreateRequestBackendOneOf1
 */
export interface SecretsCreateRequestBackendOneOf1 {
    /**
     * 
     */
    kind: SecretsCreateRequestBackendOneOf1KindEnum;
    /**
     * 
     */
    material: string;
}


/**
 * @export
 */
export const SecretsCreateRequestBackendOneOf1KindEnum = {
    ProtectedFile: 'protected_file',
    Os: 'os',
} as const;
export type SecretsCreateRequestBackendOneOf1KindEnum = typeof SecretsCreateRequestBackendOneOf1KindEnum[keyof typeof SecretsCreateRequestBackendOneOf1KindEnum];

/**
 * 
 * @export
 * @interface SecretsRevokeRequest
 */
export interface SecretsRevokeRequest {
    /**
     * 
     */
    expectedRevision: number;
}
/**
 * 
 * @export
 * @interface SecretsRotateRequest
 */
export interface SecretsRotateRequest {
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    backend: SecretsCreateRequestBackend;
    /**
     * 
     */
    allowedConsumers?: Array<ConsumerInput>;
}
/**
 * 
 * @export
 * @interface SeedApply
 */
export interface SeedApply {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    formed: TimePointRequest;
    /**
     * 
     */
    selectedIndexes?: Array<number>;
    /**
     * 
     */
    changes?: Array<KnowledgeChange>;
}
/**
 * 
 * @export
 * @interface SeedApplyInput
 */
export interface SeedApplyInput {
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    formed: TimePointRequestInput;
    /**
     * 
     */
    selectedIndexes?: Array<number>;
    /**
     * 
     */
    changes?: Array<KnowledgeChangeInput>;
}
/**
 * @type Selector
 * 
 * @export
 */
export type Selector = SelectorOneOf | SelectorOneOf1;
/**
 * @type SelectorInput
 * 
 * @export
 */
export type SelectorInput = SelectorInputOneOf | SelectorInputOneOf1;
/**
 * 
 * @export
 * @interface SelectorInputOneOf
 */
export interface SelectorInputOneOf {
    /**
     * 
     */
    kind: SelectorInputOneOfKindEnum;
    /**
     * 
     */
    pointer: string;
    /**
     * 
     */
    within?: SelectorInput;
}


/**
 * @export
 */
export const SelectorInputOneOfKindEnum = {
    Node: 'node',
} as const;
export type SelectorInputOneOfKindEnum = typeof SelectorInputOneOfKindEnum[keyof typeof SelectorInputOneOfKindEnum];

/**
 * 
 * @export
 * @interface SelectorInputOneOf1
 */
export interface SelectorInputOneOf1 {
    /**
     * 
     */
    kind: SelectorInputOneOf1KindEnum;
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
export const SelectorInputOneOf1KindEnum = {
    Text: 'text',
    Page: 'page',
    Image: 'image',
    Media: 'media',
    Part: 'part',
} as const;
export type SelectorInputOneOf1KindEnum = typeof SelectorInputOneOf1KindEnum[keyof typeof SelectorInputOneOf1KindEnum];

/**
 * 
 * @export
 * @interface SelectorOneOf
 */
export interface SelectorOneOf {
    /**
     * 
     */
    kind: SelectorOneOfKindEnum;
    /**
     * 
     */
    pointer: string;
    /**
     * 
     */
    within?: Selector;
}


/**
 * @export
 */
export const SelectorOneOfKindEnum = {
    Node: 'node',
} as const;
export type SelectorOneOfKindEnum = typeof SelectorOneOfKindEnum[keyof typeof SelectorOneOfKindEnum];

/**
 * 
 * @export
 * @interface SelectorOneOf1
 */
export interface SelectorOneOf1 {
    /**
     * 
     */
    kind: SelectorOneOf1KindEnum;
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
export const SelectorOneOf1KindEnum = {
    Text: 'text',
    Page: 'page',
    Image: 'image',
    Media: 'media',
    Part: 'part',
} as const;
export type SelectorOneOf1KindEnum = typeof SelectorOneOf1KindEnum[keyof typeof SelectorOneOf1KindEnum];

/**
 * @type SelectorQuery
 * 
 * @export
 */
export type SelectorQuery = SelectorQueryOneOf | SelectorQueryOneOf1;
/**
 * @type SelectorQueryInput
 * 
 * @export
 */
export type SelectorQueryInput = SelectorQueryInputOneOf | SelectorQueryInputOneOf1;
/**
 * 
 * @export
 * @interface SelectorQueryInputOneOf
 */
export interface SelectorQueryInputOneOf {
    /**
     * 
     */
    kind: SelectorQueryInputOneOfKindEnum;
    /**
     * 
     */
    pointer: string;
    /**
     * 
     */
    within?: SelectorQueryInput;
}


/**
 * @export
 */
export const SelectorQueryInputOneOfKindEnum = {
    Node: 'node',
} as const;
export type SelectorQueryInputOneOfKindEnum = typeof SelectorQueryInputOneOfKindEnum[keyof typeof SelectorQueryInputOneOfKindEnum];

/**
 * 
 * @export
 * @interface SelectorQueryInputOneOf1
 */
export interface SelectorQueryInputOneOf1 {
    /**
     * 
     */
    kind: SelectorQueryInputOneOf1KindEnum;
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
    within?: SelectorQueryInput;
}


/**
 * @export
 */
export const SelectorQueryInputOneOf1KindEnum = {
    Text: 'text',
    Page: 'page',
    Image: 'image',
    Media: 'media',
    Part: 'part',
} as const;
export type SelectorQueryInputOneOf1KindEnum = typeof SelectorQueryInputOneOf1KindEnum[keyof typeof SelectorQueryInputOneOf1KindEnum];

/**
 * 
 * @export
 * @interface SelectorQueryOneOf
 */
export interface SelectorQueryOneOf {
    /**
     * 
     */
    kind: SelectorQueryOneOfKindEnum;
    /**
     * 
     */
    pointer: string;
    /**
     * 
     */
    within?: SelectorQuery;
}


/**
 * @export
 */
export const SelectorQueryOneOfKindEnum = {
    Node: 'node',
} as const;
export type SelectorQueryOneOfKindEnum = typeof SelectorQueryOneOfKindEnum[keyof typeof SelectorQueryOneOfKindEnum];

/**
 * 
 * @export
 * @interface SelectorQueryOneOf1
 */
export interface SelectorQueryOneOf1 {
    /**
     * 
     */
    kind: SelectorQueryOneOf1KindEnum;
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
    within?: SelectorQuery;
}


/**
 * @export
 */
export const SelectorQueryOneOf1KindEnum = {
    Text: 'text',
    Page: 'page',
    Image: 'image',
    Media: 'media',
    Part: 'part',
} as const;
export type SelectorQueryOneOf1KindEnum = typeof SelectorQueryOneOf1KindEnum[keyof typeof SelectorQueryOneOf1KindEnum];

/**
 * 
 * @export
 * @interface Self
 */
export interface Self {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: SelfKindEnum;
    /**
     * 
     */
    aspect: SelfAspectEnum;
    /**
     * 
     */
    context?: string;
    /**
     * 
     */
    stability: SelfStabilityEnum;
}


/**
 * @export
 */
export const SelfKindEnum = {
    Self: 'Self',
} as const;
export type SelfKindEnum = typeof SelfKindEnum[keyof typeof SelfKindEnum];

/**
 * @export
 */
export const SelfAspectEnum = {
    Identity: 'identity',
    Role: 'role',
    Preference: 'preference',
    Value: 'value',
    Expression: 'expression',
    Skill: 'skill',
    DomainKnowledge: 'domain_knowledge',
    Limitation: 'limitation',
    Narrative: 'narrative',
} as const;
export type SelfAspectEnum = typeof SelfAspectEnum[keyof typeof SelfAspectEnum];

/**
 * @export
 */
export const SelfStabilityEnum = {
    Developing: 'developing',
    Stable: 'stable',
} as const;
export type SelfStabilityEnum = typeof SelfStabilityEnum[keyof typeof SelfStabilityEnum];

/**
 * 
 * @export
 * @interface SelfInput
 */
export interface SelfInput {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: SelfInputKindEnum;
    /**
     * 
     */
    aspect: SelfInputAspectEnum;
    /**
     * 
     */
    context?: string;
    /**
     * 
     */
    stability?: SelfInputStabilityEnum;
}


/**
 * @export
 */
export const SelfInputKindEnum = {
    Self: 'Self',
} as const;
export type SelfInputKindEnum = typeof SelfInputKindEnum[keyof typeof SelfInputKindEnum];

/**
 * @export
 */
export const SelfInputAspectEnum = {
    Identity: 'identity',
    Role: 'role',
    Preference: 'preference',
    Value: 'value',
    Expression: 'expression',
    Skill: 'skill',
    DomainKnowledge: 'domain_knowledge',
    Limitation: 'limitation',
    Narrative: 'narrative',
} as const;
export type SelfInputAspectEnum = typeof SelfInputAspectEnum[keyof typeof SelfInputAspectEnum];

/**
 * @export
 */
export const SelfInputStabilityEnum = {
    Developing: 'developing',
    Stable: 'stable',
} as const;
export type SelfInputStabilityEnum = typeof SelfInputStabilityEnum[keyof typeof SelfInputStabilityEnum];

/**
 * 
 * @export
 * @interface SettingsBundle
 */
export interface SettingsBundle {
    /**
     * 
     */
    formatVersion: SettingsBundleFormatVersionEnum;
    /**
     * 
     */
    historyComplete: boolean;
    /**
     * 
     */
    sourceBundleRef?: Ref;
    /**
     * 
     */
    definitions: Array<ModuleDescription>;
    /**
     * 
     */
    heads: Array<SettingsBundleHeadsInner>;
    /**
     * 
     */
    revisions: Array<SettingsBundleRevisionsInner>;
}


/**
 * @export
 */
export const SettingsBundleFormatVersionEnum = {
    NUMBER_1: 1,
} as const;
export type SettingsBundleFormatVersionEnum = typeof SettingsBundleFormatVersionEnum[keyof typeof SettingsBundleFormatVersionEnum];

/**
 * 
 * @export
 * @interface SettingsBundleHeadsInner
 */
export interface SettingsBundleHeadsInner {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface SettingsBundleInput
 */
export interface SettingsBundleInput {
    /**
     * 
     */
    formatVersion: SettingsBundleInputFormatVersionEnum;
    /**
     * 
     */
    historyComplete: boolean;
    /**
     * 
     */
    sourceBundleRef?: RefInput;
    /**
     * 
     */
    definitions: Array<ModuleDescriptionInput>;
    /**
     * 
     */
    heads: Array<SettingsBundleInputHeadsInner>;
    /**
     * 
     */
    revisions: Array<SettingsBundleInputRevisionsInner>;
}


/**
 * @export
 */
export const SettingsBundleInputFormatVersionEnum = {
    NUMBER_1: 1,
} as const;
export type SettingsBundleInputFormatVersionEnum = typeof SettingsBundleInputFormatVersionEnum[keyof typeof SettingsBundleInputFormatVersionEnum];

/**
 * 
 * @export
 * @interface SettingsBundleInputHeadsInner
 */
export interface SettingsBundleInputHeadsInner {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface SettingsBundleInputRevisionsInner
 */
export interface SettingsBundleInputRevisionsInner {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    definitionRevision: string;
    /**
     * 
     */
    sparse: { [key: string]: JsonValueInput; };
    /**
     * 
     */
    patch: Array<PatchOperationInput>;
    /**
     * 
     */
    actor: ActorInput;
    /**
     * 
     */
    reason?: string;
    /**
     * 
     */
    recordedAt: string;
    /**
     * 
     */
    origin?: SettingsRevisionOriginInput;
}
/**
 * 
 * @export
 * @interface SettingsBundleRevisionsInner
 */
export interface SettingsBundleRevisionsInner {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    definitionRevision: string;
    /**
     * 
     */
    sparse: { [key: string]: JsonValue; };
    /**
     * 
     */
    patch: Array<PatchOperation>;
    /**
     * 
     */
    actor: Actor;
    /**
     * 
     */
    reason?: string;
    /**
     * 
     */
    recordedAt: string;
    /**
     * 
     */
    origin?: SettingsRevisionOrigin;
}
/**
 * 
 * @export
 * @interface SettingsChange
 */
export interface SettingsChange {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    reason?: string;
    /**
     * 
     */
    patch: Array<PatchOperation>;
}
/**
 * 
 * @export
 * @interface SettingsChangeInput
 */
export interface SettingsChangeInput {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    reason?: string;
    /**
     * 
     */
    patch: Array<PatchOperationInput>;
}
/**
 * 
 * @export
 * @interface SettingsChangeResult
 */
export interface SettingsChangeResult {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    operationId: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    changed: boolean;
    /**
     * 
     */
    snapshot: ConfigSnapshot;
    /**
     * 
     */
    effects: SettingsChangeResultInputEffects;
}
/**
 * 
 * @export
 * @interface SettingsChangeResultInput
 */
export interface SettingsChangeResultInput {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    operationId: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    changed: boolean;
    /**
     * 
     */
    snapshot: ConfigSnapshotInput;
    /**
     * 
     */
    effects: SettingsChangeResultInputEffects;
}
/**
 * 
 * @export
 * @interface SettingsChangeResultInputEffects
 */
export interface SettingsChangeResultInputEffects {
    /**
     * 
     */
    hot: Array<string>;
    /**
     * 
     */
    nextCall: Array<string>;
    /**
     * 
     */
    restart: Array<string>;
}
/**
 * 
 * @export
 * @interface SettingsDescribe
 */
export interface SettingsDescribe {
    /**
     * 
     */
    namespace?: string;
    /**
     * 
     */
    scope?: ConfigScope;
    /**
     * 
     */
    definitionRevision?: string;
}
/**
 * 
 * @export
 * @interface SettingsDescribeInput
 */
export interface SettingsDescribeInput {
    /**
     * 
     */
    namespace?: string;
    /**
     * 
     */
    scope?: ConfigScopeInput;
    /**
     * 
     */
    definitionRevision?: string;
}
/**
 * 
 * @export
 * @interface SettingsHistory
 */
export interface SettingsHistory {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
}
/**
 * 
 * @export
 * @interface SettingsHistoryInput
 */
export interface SettingsHistoryInput {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    cursor?: string;
    /**
     * 
     */
    limit?: number;
}
/**
 * 
 * @export
 * @interface SettingsHistoryPage
 */
export interface SettingsHistoryPage {
    /**
     * 
     */
    items: Array<SettingsRevision>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface SettingsHistoryPageInput
 */
export interface SettingsHistoryPageInput {
    /**
     * 
     */
    items: Array<SettingsRevisionInput>;
    /**
     * 
     */
    nextCursor?: string;
}
/**
 * 
 * @export
 * @interface SettingsRead
 */
export interface SettingsRead {
    /**
     * 
     */
    namespaces: Array<string>;
    /**
     * 
     */
    scope: ConfigScope;
}
/**
 * 
 * @export
 * @interface SettingsReadInput
 */
export interface SettingsReadInput {
    /**
     * 
     */
    namespaces: Array<string>;
    /**
     * 
     */
    scope: ConfigScopeInput;
}
/**
 * 
 * @export
 * @interface SettingsReset
 */
export interface SettingsReset {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    reason?: string;
    /**
     * 
     */
    paths?: Array<string>;
}
/**
 * 
 * @export
 * @interface SettingsResetInput
 */
export interface SettingsResetInput {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    reason?: string;
    /**
     * 
     */
    paths?: Array<string>;
}
/**
 * 
 * @export
 * @interface SettingsRestore
 */
export interface SettingsRestore {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    reason?: string;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface SettingsRestoreInput
 */
export interface SettingsRestoreInput {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    reason?: string;
    /**
     * 
     */
    revision: number;
}
/**
 * 
 * @export
 * @interface SettingsRevision
 */
export interface SettingsRevision {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    definitionRevision: string;
    /**
     * 
     */
    sparse: { [key: string]: JsonValue; };
    /**
     * 
     */
    patch: Array<PatchOperation>;
    /**
     * 
     */
    actor: Actor;
    /**
     * 
     */
    reason?: string;
    /**
     * 
     */
    recordedAt: string;
    /**
     * 
     */
    definition: ModuleDescription;
    /**
     * 
     */
    origin?: SettingsRevisionOrigin;
}
/**
 * 
 * @export
 * @interface SettingsRevisionInput
 */
export interface SettingsRevisionInput {
    /**
     * 
     */
    namespace: string;
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    definitionRevision: string;
    /**
     * 
     */
    sparse: { [key: string]: JsonValueInput; };
    /**
     * 
     */
    patch: Array<PatchOperationInput>;
    /**
     * 
     */
    actor: ActorInput;
    /**
     * 
     */
    reason?: string;
    /**
     * 
     */
    recordedAt: string;
    /**
     * 
     */
    definition: ModuleDescriptionInput;
    /**
     * 
     */
    origin?: SettingsRevisionOriginInput;
}
/**
 * 
 * @export
 * @interface SettingsRevisionOrigin
 */
export interface SettingsRevisionOrigin {
    /**
     * 
     */
    scope: ConfigScope;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    actor: Actor;
    /**
     * 
     */
    recordedAt: string;
    /**
     * 
     */
    definitionRevision: string;
    /**
     * 
     */
    sourceBundleRef?: Ref;
    /**
     * 
     */
    previous?: SettingsRevisionOrigin;
}
/**
 * 
 * @export
 * @interface SettingsRevisionOriginInput
 */
export interface SettingsRevisionOriginInput {
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    actor: ActorInput;
    /**
     * 
     */
    recordedAt: string;
    /**
     * 
     */
    definitionRevision: string;
    /**
     * 
     */
    sourceBundleRef?: RefInput;
    /**
     * 
     */
    previous?: SettingsRevisionOriginInput;
}
/**
 * 
 * @export
 * @interface SettingsScopeMapInner
 */
export interface SettingsScopeMapInner {
    /**
     * 
     */
    from: ConfigScope;
    /**
     * 
     */
    to: ConfigScope;
    /**
     * 
     */
    expectedRevisions: { [key: string]: number; };
}
/**
 * 
 * @export
 * @interface SettingsScopeMapInputInner
 */
export interface SettingsScopeMapInputInner {
    /**
     * 
     */
    from: ConfigScopeInput;
    /**
     * 
     */
    to: ConfigScopeInput;
    /**
     * 
     */
    expectedRevisions: { [key: string]: number; };
}
/**
 * 
 * @export
 * @interface Social
 */
export interface Social {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs: Array<Ref>;
    /**
     * 
     */
    conceptRefs: Array<Ref>;
    /**
     * 
     */
    tags: Array<string>;
    /**
     * 
     */
    kind: SocialKindEnum;
    /**
     * 
     */
    aspect: SocialAspectEnum;
    /**
     * 
     */
    fromRef: Ref;
    /**
     * 
     */
    toRef?: Ref;
    /**
     * 
     */
    dimension?: string;
    /**
     * 
     */
    degree?: number;
    /**
     * 
     */
    domain?: string;
    /**
     * 
     */
    context?: string;
}


/**
 * @export
 */
export const SocialKindEnum = {
    Social: 'Social',
} as const;
export type SocialKindEnum = typeof SocialKindEnum[keyof typeof SocialKindEnum];

/**
 * @export
 */
export const SocialAspectEnum = {
    Person: 'person',
    Relation: 'relation',
    Group: 'group',
} as const;
export type SocialAspectEnum = typeof SocialAspectEnum[keyof typeof SocialAspectEnum];

/**
 * 
 * @export
 * @interface SocialInput
 */
export interface SocialInput {
    /**
     * 
     */
    content: string;
    /**
     * 
     */
    title?: string;
    /**
     * 
     */
    entityRefs?: Array<RefInput>;
    /**
     * 
     */
    conceptRefs?: Array<RefInput>;
    /**
     * 
     */
    tags?: Array<string>;
    /**
     * 
     */
    kind: SocialInputKindEnum;
    /**
     * 
     */
    aspect: SocialInputAspectEnum;
    /**
     * 
     */
    fromRef: RefInput;
    /**
     * 
     */
    toRef?: RefInput;
    /**
     * 
     */
    dimension?: string;
    /**
     * 
     */
    degree?: number;
    /**
     * 
     */
    domain?: string;
    /**
     * 
     */
    context?: string;
}


/**
 * @export
 */
export const SocialInputKindEnum = {
    Social: 'Social',
} as const;
export type SocialInputKindEnum = typeof SocialInputKindEnum[keyof typeof SocialInputKindEnum];

/**
 * @export
 */
export const SocialInputAspectEnum = {
    Person: 'person',
    Relation: 'relation',
    Group: 'group',
} as const;
export type SocialInputAspectEnum = typeof SocialInputAspectEnum[keyof typeof SocialInputAspectEnum];

/**
 * 
 * @export
 * @interface SourceResolution
 */
export interface SourceResolution {
    /**
     * 
     */
    resolvedRefs: Array<Ref>;
    /**
     * 
     */
    roots: Array<Ref>;
    /**
     * 
     */
    policies: Array<Policy>;
}
/**
 * 
 * @export
 * @interface SourceResolutionInput
 */
export interface SourceResolutionInput {
    /**
     * 
     */
    resolvedRefs: Array<RefInput>;
    /**
     * 
     */
    roots: Array<RefInput>;
    /**
     * 
     */
    policies: Array<PolicyInput>;
}
/**
 * 
 * @export
 * @interface SourcesReadPoliciesRequest
 */
export interface SourcesReadPoliciesRequest {
    /**
     * 
     */
    refs: Array<RefInput>;
}
/**
 * 
 * @export
 * @interface SourcesResolveBody
 */
export interface SourcesResolveBody {
    /**
     * 
     */
    refs: Array<Ref>;
}
/**
 * 
 * @export
 * @interface SourcesResolveBodyInput
 */
export interface SourcesResolveBodyInput {
    /**
     * 
     */
    refs: Array<RefInput>;
}
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
 * @interface TasksPlanRecovery200Response
 */
export interface TasksPlanRecovery200Response {
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    sessionKey: string;
    /**
     * 
     */
    sessionId: string;
    /**
     * 
     */
    runId: string;
    /**
     * 
     */
    callId: string;
    /**
     * 
     */
    terminalEntryId: string;
    /**
     * 
     */
    pendingToolCallIds: Array<string>;
    /**
     * 
     */
    executionScope: TasksPlanRecovery200ResponseExecutionScope;
}
/**
 * 
 * @export
 * @interface TasksPlanRecovery200ResponseExecutionScope
 */
export interface TasksPlanRecovery200ResponseExecutionScope {
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    agentId: string;
    /**
     * 
     */
    sessionKey: string;
    /**
     * 
     */
    workspaceRef?: Ref;
    /**
     * 
     */
    allowedTools: Array<string>;
    /**
     * 
     */
    model: TasksPlanRecovery200ResponseExecutionScopeModel;
}
/**
 * 
 * @export
 * @interface TasksPlanRecovery200ResponseExecutionScopeModel
 */
export interface TasksPlanRecovery200ResponseExecutionScopeModel {
    /**
     * 
     */
    runtimeId: string;
    /**
     * 
     */
    nativeResourceId: string;
    /**
     * 
     */
    configRevision: string;
    /**
     * 
     */
    actualProvider: string;
    /**
     * 
     */
    actualModelId: string;
    /**
     * 
     */
    kind: ModelKind;
    /**
     * 
     */
    capabilities: Array<string>;
    /**
     * 
     */
    contextLimit?: number;
    /**
     * 
     */
    outputLimit?: number;
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
    workspaceRef?: RefInput;
    /**
     * 
     */
    budget?: ModelBudgetInput;
    /**
     * 
     */
    expiresAt?: TimePointRequestInput;
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
 * @type TemporalExtent
 * 
 * @export
 */
export type TemporalExtent = TemporalExtentInputOneOf | TemporalExtentOneOf | TemporalExtentOneOf1;
/**
 * @type TemporalExtentInput
 * 
 * @export
 */
export type TemporalExtentInput = TemporalExtentInputOneOf | TemporalExtentInputOneOf1 | TemporalExtentInputOneOf2;
/**
 * 
 * @export
 * @interface TemporalExtentInputOneOf
 */
export interface TemporalExtentInputOneOf {
    /**
     * 
     */
    kind: TemporalExtentInputOneOfKindEnum;
}


/**
 * @export
 */
export const TemporalExtentInputOneOfKindEnum = {
    Unknown: 'unknown',
} as const;
export type TemporalExtentInputOneOfKindEnum = typeof TemporalExtentInputOneOfKindEnum[keyof typeof TemporalExtentInputOneOfKindEnum];

/**
 * 
 * @export
 * @interface TemporalExtentInputOneOf1
 */
export interface TemporalExtentInputOneOf1 {
    /**
     * 
     */
    kind: TemporalExtentInputOneOf1KindEnum;
    /**
     * 
     */
    point: TimePointInput;
}


/**
 * @export
 */
export const TemporalExtentInputOneOf1KindEnum = {
    Instant: 'instant',
} as const;
export type TemporalExtentInputOneOf1KindEnum = typeof TemporalExtentInputOneOf1KindEnum[keyof typeof TemporalExtentInputOneOf1KindEnum];

/**
 * 
 * @export
 * @interface TemporalExtentInputOneOf2
 */
export interface TemporalExtentInputOneOf2 {
    /**
     * 
     */
    kind: TemporalExtentInputOneOf2KindEnum;
    /**
     * 
     */
    range: TimeRangeInput;
}


/**
 * @export
 */
export const TemporalExtentInputOneOf2KindEnum = {
    Interval: 'interval',
} as const;
export type TemporalExtentInputOneOf2KindEnum = typeof TemporalExtentInputOneOf2KindEnum[keyof typeof TemporalExtentInputOneOf2KindEnum];

/**
 * 
 * @export
 * @interface TemporalExtentOneOf
 */
export interface TemporalExtentOneOf {
    /**
     * 
     */
    kind: TemporalExtentOneOfKindEnum;
    /**
     * 
     */
    point: TimePoint;
}


/**
 * @export
 */
export const TemporalExtentOneOfKindEnum = {
    Instant: 'instant',
} as const;
export type TemporalExtentOneOfKindEnum = typeof TemporalExtentOneOfKindEnum[keyof typeof TemporalExtentOneOfKindEnum];

/**
 * 
 * @export
 * @interface TemporalExtentOneOf1
 */
export interface TemporalExtentOneOf1 {
    /**
     * 
     */
    kind: TemporalExtentOneOf1KindEnum;
    /**
     * 
     */
    range: TimeRange;
}


/**
 * @export
 */
export const TemporalExtentOneOf1KindEnum = {
    Interval: 'interval',
} as const;
export type TemporalExtentOneOf1KindEnum = typeof TemporalExtentOneOf1KindEnum[keyof typeof TemporalExtentOneOf1KindEnum];

/**
 * 
 * @export
 * @interface TimeBindingsUpdateRequest
 */
export interface TimeBindingsUpdateRequest {
    /**
     * 
     */
    scope: ConfigScopeInput;
    /**
     * 
     */
    expectedRevision: number;
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    preferClock?: RefInput;
}
/**
 * 
 * @export
 * @interface TimeCaptureBody
 */
export interface TimeCaptureBody {
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    domainId?: string;
    /**
     * 
     */
    preferClock?: ClockRef;
    /**
     * 
     */
    existingOnly?: boolean;
}
/**
 * 
 * @export
 * @interface TimeCaptureBodyInput
 */
export interface TimeCaptureBodyInput {
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    domainId?: string;
    /**
     * 
     */
    preferClock?: ClockRefInput;
    /**
     * 
     */
    existingOnly?: boolean;
}
/**
 * @type TimeCaptureReceipt
 * 
 * @export
 */
export type TimeCaptureReceipt = TimeCaptureReceiptOneOf | TimeCaptureReceiptOneOf1;
/**
 * @type TimeCaptureReceiptInput
 * 
 * @export
 */
export type TimeCaptureReceiptInput = TimeCaptureReceiptInputOneOf | TimeCaptureReceiptInputOneOf1;
/**
 * 
 * @export
 * @interface TimeCaptureReceiptInputOneOf
 */
export interface TimeCaptureReceiptInputOneOf {
    /**
     * 
     */
    point: CapturedTimeInputOneOfPoint;
    /**
     * 
     */
    realAt: string;
    /**
     * 
     */
    captureRef: TimeCaptureRefInput;
}
/**
 * 
 * @export
 * @interface TimeCaptureReceiptInputOneOf1
 */
export interface TimeCaptureReceiptInputOneOf1 {
    /**
     * 
     */
    point: TimePointInput;
    /**
     * 
     */
    realAt: string;
    /**
     * 
     */
    clockRef: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    clockRevision: number;
    /**
     * 
     */
    segmentRef: ClockSegmentRefInput;
    /**
     * 
     */
    captureRef: TimeCaptureRefInput;
}
/**
 * 
 * @export
 * @interface TimeCaptureReceiptOneOf
 */
export interface TimeCaptureReceiptOneOf {
    /**
     * 
     */
    point: CapturedTimeOneOfPoint;
    /**
     * 
     */
    realAt: string;
    /**
     * 
     */
    captureRef: TimeCaptureRef;
}
/**
 * 
 * @export
 * @interface TimeCaptureReceiptOneOf1
 */
export interface TimeCaptureReceiptOneOf1 {
    /**
     * 
     */
    point: TimePoint;
    /**
     * 
     */
    realAt: string;
    /**
     * 
     */
    clockRef: CapturedTimeInputOneOf1ClockRef;
    /**
     * 
     */
    clockRevision: number;
    /**
     * 
     */
    segmentRef: ClockSegmentRef;
    /**
     * 
     */
    captureRef: TimeCaptureRef;
}
/**
 * 
 * @export
 * @interface TimeCaptureRef
 */
export interface TimeCaptureRef {
    /**
     * 
     */
    product: TimeCaptureRefProductEnum;
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
    kind: TimeCaptureRefKindEnum;
    /**
     * 
     */
    id: string;
}


/**
 * @export
 */
export const TimeCaptureRefProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type TimeCaptureRefProductEnum = typeof TimeCaptureRefProductEnum[keyof typeof TimeCaptureRefProductEnum];

/**
 * @export
 */
export const TimeCaptureRefKindEnum = {
    TimeCapture: 'TimeCapture',
} as const;
export type TimeCaptureRefKindEnum = typeof TimeCaptureRefKindEnum[keyof typeof TimeCaptureRefKindEnum];

/**
 * 
 * @export
 * @interface TimeCaptureRefInput
 */
export interface TimeCaptureRefInput {
    /**
     * 
     */
    product: TimeCaptureRefInputProductEnum;
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
    kind: TimeCaptureRefInputKindEnum;
    /**
     * 
     */
    id: string;
}


/**
 * @export
 */
export const TimeCaptureRefInputProductEnum = {
    Nous: 'nous',
    Hept: 'hept',
} as const;
export type TimeCaptureRefInputProductEnum = typeof TimeCaptureRefInputProductEnum[keyof typeof TimeCaptureRefInputProductEnum];

/**
 * @export
 */
export const TimeCaptureRefInputKindEnum = {
    TimeCapture: 'TimeCapture',
} as const;
export type TimeCaptureRefInputKindEnum = typeof TimeCaptureRefInputKindEnum[keyof typeof TimeCaptureRefInputKindEnum];

/**
 * 
 * @export
 * @interface TimeDomain
 */
export interface TimeDomain {
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    label: string;
    /**
     * 
     */
    coordinateSystem: TimeDomainCoordinateSystemEnum;
    /**
     * 
     */
    precision: TimeDomainPrecisionEnum;
    /**
     * 
     */
    authorityRef: Ref;
    /**
     * 
     */
    status: TimeDomainStatusEnum;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    createdRealAt: string;
}


/**
 * @export
 */
export const TimeDomainCoordinateSystemEnum = {
    Iso8601: 'iso8601',
} as const;
export type TimeDomainCoordinateSystemEnum = typeof TimeDomainCoordinateSystemEnum[keyof typeof TimeDomainCoordinateSystemEnum];

/**
 * @export
 */
export const TimeDomainPrecisionEnum = {
    Microsecond: 'microsecond',
} as const;
export type TimeDomainPrecisionEnum = typeof TimeDomainPrecisionEnum[keyof typeof TimeDomainPrecisionEnum];

/**
 * @export
 */
export const TimeDomainStatusEnum = {
    Active: 'active',
    Retired: 'retired',
} as const;
export type TimeDomainStatusEnum = typeof TimeDomainStatusEnum[keyof typeof TimeDomainStatusEnum];

/**
 * 
 * @export
 * @interface TimeDomainCreateRequest
 */
export interface TimeDomainCreateRequest {
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    label: string;
    /**
     * 
     */
    subjectId?: string;
}
/**
 * 
 * @export
 * @interface TimeDomainCreateRequestInput
 */
export interface TimeDomainCreateRequestInput {
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    label: string;
    /**
     * 
     */
    subjectId?: string;
}
/**
 * 
 * @export
 * @interface TimeDomainInput
 */
export interface TimeDomainInput {
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    label: string;
    /**
     * 
     */
    coordinateSystem: TimeDomainInputCoordinateSystemEnum;
    /**
     * 
     */
    precision: TimeDomainInputPrecisionEnum;
    /**
     * 
     */
    authorityRef: RefInput;
    /**
     * 
     */
    status: TimeDomainInputStatusEnum;
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    createdRealAt: string;
}


/**
 * @export
 */
export const TimeDomainInputCoordinateSystemEnum = {
    Iso8601: 'iso8601',
} as const;
export type TimeDomainInputCoordinateSystemEnum = typeof TimeDomainInputCoordinateSystemEnum[keyof typeof TimeDomainInputCoordinateSystemEnum];

/**
 * @export
 */
export const TimeDomainInputPrecisionEnum = {
    Microsecond: 'microsecond',
} as const;
export type TimeDomainInputPrecisionEnum = typeof TimeDomainInputPrecisionEnum[keyof typeof TimeDomainInputPrecisionEnum];

/**
 * @export
 */
export const TimeDomainInputStatusEnum = {
    Active: 'active',
    Retired: 'retired',
} as const;
export type TimeDomainInputStatusEnum = typeof TimeDomainInputStatusEnum[keyof typeof TimeDomainInputStatusEnum];

/**
 * 
 * @export
 * @interface TimePoint
 */
export interface TimePoint {
    /**
     * 
     */
    domainId: string;
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
    domainId: string;
    /**
     * 
     */
    at: string;
}
/**
 * 
 * @export
 * @interface TimePointRequest
 */
export interface TimePointRequest {
    /**
     * 
     */
    domainId: string;
    /**
     * 
     */
    at: any;
}
/**
 * 
 * @export
 * @interface TimePointRequestInput
 */
export interface TimePointRequestInput {
    /**
     * 
     */
    domainId: string;
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
 * @interface TimeRangeRequest
 */
export interface TimeRangeRequest {
    /**
     * 
     */
    start?: TimePointRequest;
    /**
     * 
     */
    end?: TimePointRequest;
}
/**
 * 
 * @export
 * @interface TimeRangeRequestInput
 */
export interface TimeRangeRequestInput {
    /**
     * 
     */
    start?: TimePointRequestInput;
    /**
     * 
     */
    end?: TimePointRequestInput;
}
/**
 * 
 * @export
 * @interface TimeSelection
 */
export interface TimeSelection {
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    domainId?: string;
    /**
     * 
     */
    preferClock?: ClockRef;
}
/**
 * 
 * @export
 * @interface TimeSelectionInput
 */
export interface TimeSelectionInput {
    /**
     * 
     */
    subjectId?: string;
    /**
     * 
     */
    domainId?: string;
    /**
     * 
     */
    preferClock?: ClockRefInput;
}
/**
 * 
 * @export
 * @interface TokenEstimate
 */
export interface TokenEstimate {
    /**
     * 
     */
    value: number;
    /**
     * 
     */
    method: string;
}
/**
 * 
 * @export
 * @interface TokenEstimateInput
 */
export interface TokenEstimateInput {
    /**
     * 
     */
    value: number;
    /**
     * 
     */
    method: string;
}
/**
 * 
 * @export
 * @interface TraceContext
 */
export interface TraceContext {
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
    /**
     * 
     */
    invocationId?: string;
    /**
     * 
     */
    taskId?: string;
    /**
     * 
     */
    effectId?: string;
}
/**
 * 
 * @export
 * @interface TraceContextInput
 */
export interface TraceContextInput {
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
    /**
     * 
     */
    invocationId?: string;
    /**
     * 
     */
    taskId?: string;
    /**
     * 
     */
    effectId?: string;
}
/**
 * 
 * @export
 * @interface UsageQuantity
 */
export interface UsageQuantity {
    /**
     * 
     */
    unit: string;
    /**
     * 
     */
    quantity: string;
    /**
     * 
     */
    source: UsageQuantitySourceEnum;
}


/**
 * @export
 */
export const UsageQuantitySourceEnum = {
    Provider: 'provider',
    Measured: 'measured',
    Estimated: 'estimated',
} as const;
export type UsageQuantitySourceEnum = typeof UsageQuantitySourceEnum[keyof typeof UsageQuantitySourceEnum];

/**
 * 
 * @export
 * @interface UsageQuantityInput
 */
export interface UsageQuantityInput {
    /**
     * 
     */
    unit: string;
    /**
     * 
     */
    quantity: string;
    /**
     * 
     */
    source: UsageQuantityInputSourceEnum;
}


/**
 * @export
 */
export const UsageQuantityInputSourceEnum = {
    Provider: 'provider',
    Measured: 'measured',
    Estimated: 'estimated',
} as const;
export type UsageQuantityInputSourceEnum = typeof UsageQuantityInputSourceEnum[keyof typeof UsageQuantityInputSourceEnum];

/**
 * 
 * @export
 * @interface WorkContext
 */
export interface WorkContext {
    /**
     * 
     */
    goal: string;
    /**
     * 
     */
    openQuestions: Array<string>;
    /**
     * 
     */
    progress: string;
    /**
     * 
     */
    currentRefs: Array<Ref>;
    /**
     * 
     */
    temporaryNotes: Array<string>;
    /**
     * 
     */
    resumeCue: string;
    /**
     * 
     */
    participantRefs: Array<Ref>;
    /**
     * 
     */
    lifecycle: WorkContextLifecycleEnum;
    /**
     * 
     */
    relatedRefs: Array<Ref>;
    /**
     * 
     */
    scope: Consumer;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    ref: Ref;
    /**
     * 
     */
    recorded: string;
}


/**
 * @export
 */
export const WorkContextLifecycleEnum = {
    Active: 'active',
    Paused: 'paused',
    Completed: 'completed',
} as const;
export type WorkContextLifecycleEnum = typeof WorkContextLifecycleEnum[keyof typeof WorkContextLifecycleEnum];

/**
 * 
 * @export
 * @interface WorkContextBody
 */
export interface WorkContextBody {
    /**
     * 
     */
    goal: string;
    /**
     * 
     */
    openQuestions: Array<string>;
    /**
     * 
     */
    progress: string;
    /**
     * 
     */
    currentRefs: Array<Ref>;
    /**
     * 
     */
    temporaryNotes: Array<string>;
    /**
     * 
     */
    resumeCue: string;
    /**
     * 
     */
    participantRefs: Array<Ref>;
    /**
     * 
     */
    lifecycle: WorkContextBodyLifecycleEnum;
    /**
     * 
     */
    relatedRefs: Array<Ref>;
}


/**
 * @export
 */
export const WorkContextBodyLifecycleEnum = {
    Active: 'active',
    Paused: 'paused',
    Completed: 'completed',
} as const;
export type WorkContextBodyLifecycleEnum = typeof WorkContextBodyLifecycleEnum[keyof typeof WorkContextBodyLifecycleEnum];

/**
 * 
 * @export
 * @interface WorkContextBodyInput
 */
export interface WorkContextBodyInput {
    /**
     * 
     */
    goal: string;
    /**
     * 
     */
    openQuestions?: Array<string>;
    /**
     * 
     */
    progress?: string;
    /**
     * 
     */
    currentRefs?: Array<RefInput>;
    /**
     * 
     */
    temporaryNotes?: Array<string>;
    /**
     * 
     */
    resumeCue?: string;
    /**
     * 
     */
    participantRefs?: Array<RefInput>;
    /**
     * 
     */
    lifecycle?: WorkContextBodyInputLifecycleEnum;
    /**
     * 
     */
    relatedRefs?: Array<RefInput>;
}


/**
 * @export
 */
export const WorkContextBodyInputLifecycleEnum = {
    Active: 'active',
    Paused: 'paused',
    Completed: 'completed',
} as const;
export type WorkContextBodyInputLifecycleEnum = typeof WorkContextBodyInputLifecycleEnum[keyof typeof WorkContextBodyInputLifecycleEnum];

/**
 * 
 * @export
 * @interface WorkContextInput
 */
export interface WorkContextInput {
    /**
     * 
     */
    goal: string;
    /**
     * 
     */
    openQuestions?: Array<string>;
    /**
     * 
     */
    progress?: string;
    /**
     * 
     */
    currentRefs?: Array<RefInput>;
    /**
     * 
     */
    temporaryNotes?: Array<string>;
    /**
     * 
     */
    resumeCue?: string;
    /**
     * 
     */
    participantRefs?: Array<RefInput>;
    /**
     * 
     */
    lifecycle?: WorkContextInputLifecycleEnum;
    /**
     * 
     */
    relatedRefs?: Array<RefInput>;
    /**
     * 
     */
    scope: ConsumerInput;
    /**
     * 
     */
    id: string;
    /**
     * 
     */
    subjectId: string;
    /**
     * 
     */
    revision: number;
    /**
     * 
     */
    ref: RefInput;
    /**
     * 
     */
    recorded: string;
}


/**
 * @export
 */
export const WorkContextInputLifecycleEnum = {
    Active: 'active',
    Paused: 'paused',
    Completed: 'completed',
} as const;
export type WorkContextInputLifecycleEnum = typeof WorkContextInputLifecycleEnum[keyof typeof WorkContextInputLifecycleEnum];

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
    visibility?: WorldsPreviewRequestVisibility;
    /**
     * 
     */
    initialState?: WorldsPreviewRequestInitialState;
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
    rdates?: Array<string>;
    /**
     * 
     */
    exdates?: Array<string>;
    /**
     * 
     */
    disambiguation?: WorldsPreviewRequestCalendarInnerDisambiguationEnum;
    /**
     * 
     */
    startShiftSeconds?: number;
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
    demands?: { [key: string]: WorldsPreviewRequestCalendarInnerDemandsEnum; };
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
export const WorldsPreviewRequestCalendarInnerDisambiguationEnum = {
    Compatible: 'compatible',
    Earlier: 'earlier',
    Later: 'later',
    Reject: 'reject',
} as const;
export type WorldsPreviewRequestCalendarInnerDisambiguationEnum = typeof WorldsPreviewRequestCalendarInnerDisambiguationEnum[keyof typeof WorldsPreviewRequestCalendarInnerDisambiguationEnum];

/**
 * @export
 */
export const WorldsPreviewRequestCalendarInnerDemandsEnum = {
    None: 'none',
    Light: 'light',
    Focused: 'focused',
} as const;
export type WorldsPreviewRequestCalendarInnerDemandsEnum = typeof WorldsPreviewRequestCalendarInnerDemandsEnum[keyof typeof WorldsPreviewRequestCalendarInnerDemandsEnum];

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
    id?: string;
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
    initialAt: string;
    /**
     * 
     */
    rate: string;
    /**
     * 
     */
    timezone?: string;
    /**
     * 
     */
    offlinePolicy: ClockOfflinePolicyInput;
}
/**
 * 
 * @export
 * @interface WorldsPreviewRequestInitialState
 */
export interface WorldsPreviewRequestInitialState {
    /**
     * 
     */
    place: string;
    /**
     * 
     */
    energy?: number;
    /**
     * 
     */
    fatigue?: number;
    /**
     * 
     */
    mood?: any | null;
    /**
     * 
     */
    availableDevices?: Array<string>;
    /**
     * 
     */
    nextActivity?: string;
}
/**
 * 
 * @export
 * @interface WorldsPreviewRequestPlacesInner
 */
export interface WorldsPreviewRequestPlacesInner {
    /**
     * 
     */
    id?: string;
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
/**
 * 
 * @export
 * @interface WorldsPreviewRequestVisibility
 */
export interface WorldsPreviewRequestVisibility {
    /**
     * 
     */
    publicFiles: Array<string>;
    /**
     * 
     */
    authorFiles: Array<string>;
}
