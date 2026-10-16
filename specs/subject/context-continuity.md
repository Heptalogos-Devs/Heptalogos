# 工作继续信息与原生历史连续性

本合同是当前活动计划的施工要求；现有Life/WorkContext和原生历史继续使用，固定前缀后台压缩在受控原生入口实现并实测前不宣称完成。

## 同步继续信息

真实消息/世界/工具结果由各owner先保存；Activity保存状态、焦点/时间和产物，Nous WorkContext保存认知工作问题、约束和继续信息，共同引用同一成果，不双写完整JSON。

有意义工具成果、目标变化、委派让出、焦点切换、完成、取消和正常停止前同步保存：当前目的、最后采用成果refs、未决、下一意图和所等实际任务。无需逐token日记或额外模型总结。取消没有最终输出时保留最后已知事实和原因，不索要临终总结；跨系统失败只补交，不重跑工具。

## 唯一原生压缩

OpenClaw独占transcript及摘要发布；manual/soft/overflow合流同一Session最多一作业，无第二摘要库/worker/通用Runtime。当前Nous slice、WorldView、权限/焦点/时钟每次重建，排除出永久摘要。

以实际有效输入预算H=min(模型窗口-输出预留-计量余量, role输入cap)判断。soft初值70%H，仅完整回合自然节点后台准备，目标约50%H；身份/目标/当前世界/未处理请求/未决tool pair/重要限定不能为比例删除。换模型重新算H，较大摘要模型不扩大下次实际模型窗口。

固定结束前缀保留完整tool call/result，捕获原生generation、role/view、现用摘要代际、结束entry和许可来源；网络外生成，短CAS核验未改写/未被覆盖及来源仍允许后只替换该前缀，保留未覆盖历史与生成时新增尾部。失效产物不覆盖现用摘要，不无限重做同一前缀。

soft失败且完整输入仍可容纳可继续，明确问题；硬超窗等待同一有效作业或一次必要前台压缩，仍装不下则停止provider，保留原史。无新fallback清单，不自动扩大费用。原生memoryFlush继续关闭，可写SOUL/USER/MEMORY不成为第二人格。

## 修订、清理与实际验证

普通认知修订由managed RESET更新，历史保留当时认识；suppression/purge/禁传污染的transcript/摘要走正式history invalidation/reset，备份恢复也不能复活禁止来源。压缩不触发Memory/人格形成，subject_reflection独立有界推进。

已终结且无活动/历史/认知/恢复/pin引用、达到明确采用保留期的派生材料才可由owner清理。付费成果和待交接不因temp路径被删；没有明确破坏性policy只读占用/候选。

真实长工具任务在后台生成期间追加输入与结果，采用后继续产出；再测试完整tool pair、较小窗口硬等待、焦点切换、来源限制与重启。不以假的token计数、mock或仅摘要函数成功证明上线。原生入口的具体合同见Nous正式OpenClaw Spec。
