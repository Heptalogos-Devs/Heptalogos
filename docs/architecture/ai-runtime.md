# 原生多角色执行架构

Heptalogos的当前运行基础使用独立Nous/OpenClaw的原生agent/tool/session/scheduler与唯一channel发送，Host保留Activity、注意、行为采纳、权限和回执。旧AIRuntime/GatewayProfile/固定primary-expression路径不作为当前包导航。

本轮按[唯一活动计划](../../project/plans/qq-continuous-subject.md)接通world.planner、subject.deliberation、subject.execution、subject.render、narrative.review。角色/purpose/视角和execution_only/subject_experience由可信Host绑定供应；OpenClaw持有实际provider/model配置，Nous持有长期认知与投影。完整调用与失败合同见[原生执行Spec](../../specs/system/ai-runtime.md)。

世界/生活机会可以不含conversation；世界作者只生成候选，专业执行者交回成果，主观审议决定是否交流，独立renderer实现已采用意图，review读取最终重要陈述，NarrativeCommit在Host短事务内采用，再交唯一实际发送。代码当前已有可信消息派发、Life进展和发送边界；完整世界/角色/叙事链仍按所属Spec逐项实现，架构图不作为完成证据。

[WorldLife](../../specs/subject/world-life.md)拥有世界真值与可见投影，[NarrativeCommit](../../specs/subject/narrative-claims.md)拥有听众说法与派发关联。Nous EpistemicView约束本人认识，后台模型技能不成为个人经历。维护实例独立profile/端口/state/workspace/秘密，不加载主体人格或必需认知。
