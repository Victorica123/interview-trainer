# 2026 后端与 AI / Agent 应用岗调研结论

调研快照：2026-08-28。当前登记 51 个公开来源，其中 19 个面经来源、9 个维护资料、2 个岗位要求、19 个官方/规范资料和 2 个研究来源；15 个面经发布于 2026 年。

## 最重要的共同变化

当前公开样本更重视“把知识用在项目和故障里”，而不是只背一句定义。后端题常从缓存一致性、慢 SQL、线程池、幂等、消息可靠性继续追问到故障现象、监控证据和方案代价；Agent 题常从 RAG 或框架名继续追问评测集、Badcase、工具错误、状态恢复、权限与成本。

因此题库没有做成 985 条孤立名词，而是让每个核心概念分别练定义、机制、项目应用、故障排查和对比选型。

## Java 后端路线

建议初学者按以下顺序投入时间：

1. Java 集合、并发和 JVM：HashMap、ConcurrentHashMap、锁、JMM、线程池、GC 与 OOM 排查。
2. MySQL：索引、执行计划、事务隔离、MVCC、锁与日志。
3. Redis：数据结构、持久化、缓存异常、一致性、分布式锁与 HotKey。
4. Spring：IoC、AOP、事务、Bean 生命周期、Boot 自动配置和请求链路。
5. MQ 与分布式：可靠投递、重复消费、幂等、事务、限流熔断和最终一致性。
6. 网络、Linux 与场景设计：TCP、HTTP/TLS、I/O、线上排障、秒杀、支付回调和项目复盘。

上线前又对照 JavaGuide、小林 coding 与面试鸭近 30 天热门榜/Java 热门 200 题补齐 38 个后端知识点。新增重点包括 Java 21 虚拟线程、JIT/逃逸分析、事务传播与失效、Buffer Pool、深分页、Redis Lua/Pipeline、传输层与系统调用、MQ 积压/Kafka、网关/共识、容量估算、Netty、设计模式与搜索。补齐后 Java 后端从 107 个概念增加到 145 个概念，覆盖详情与范围限制见 [COVERAGE_AUDIT.md](COVERAGE_AUDIT.md)。

近期样本中，美团后端实习面经直接涉及缓存一致性、Spring 和 SQL；阿里样本突出项目深挖、联合索引和高并发一致性；字节样本覆盖分布式事务、幂等、服务治理和容灾；拼多多样本对 Redis、集合和并发机制追问较深。代表来源可见 [美团后端实习面经](https://www.nowcoder.com/feed/main/detail/3db24573b8f146e0b0ec6088bfb8c3a6)、[阿里淘天 Java 一面](https://www.nowcoder.com/discuss/874219579965259776)、[字节 Java 二面](https://www.nowcoder.com/discuss/860815475284955136)和[拼多多 Redis 深挖](https://www.nowcoder.com/discuss/863380155400458240)。

## AI / Agent 应用开发路线

建议按以下顺序学习：

1. 模型 API 与上下文：Token、消息角色、结构化输出、流式响应、限流重试和上下文工程。
2. RAG：清洗切分、Embedding、向量索引、混合检索、改写、Reranker、评测与知识更新。
3. Agent 运行时：Agent 与 Workflow、ReAct、Plan-and-Execute、状态机、Checkpoint 和人工介入。
4. 工具与 MCP：Function Calling、Schema 校验、幂等重试、MCP 生命周期、工具检索和 Skills。
5. 记忆与多 Agent：写入策略、检索与遗忘、协作拓扑和冲突处理。
6. 生产可靠性：任务成功率、Tracing、权限、Prompt 注入、成本路由、超时、循环检测和恢复。

在近期 Agent 面经里，RAG 很少只问定义，通常会追到切分、混检、重排、坏案例与指标；框架题也常追到 LangGraph 状态、Checkpoint、重复工具调用和恢复。MCP 已成为明显的新信号，但“协议名”本身不够，工具权限、Schema 校验和生命周期更重要。代表来源包括[腾讯 Agent 面经](https://www.nowcoder.com/discuss/878945851924627456)、[百度 Agent 面经](https://www.nowcoder.com/discuss/880841659733311488)、[AI 应用开发实习面经](https://www.nowcoder.com/feed/main/detail/76f5be8b8bd5420b94d32a66e26a7ad9)、[拼多多 Agent 面经](https://www.nowcoder.com/discuss/918542384726540288)、[字节 Agent 一面](https://www.nowcoder.com/discuss/920075216078786560)和[多公司 Agent 后端复盘](https://www.nowcoder.com/discuss/919608103723622400)。

## 对完全新手的取舍

初学者不需要一开始平均刷完 985 道。先过滤“核心必会”，每题能说出定义和两三个关键词后，再做机制和项目应用；故障排查与对比选型放在第二轮。Agent 路线也不建议同时学多个框架，先用一个小项目跑通模型调用、RAG、单工具、状态和评测，再比较 LangChain、LangGraph 或其他实现。

项目题需要准备可量化材料：问题是什么、旧方案的基线、为什么选新方案、关键失败如何定位、改动后哪些指标变化。没有真实指标时应明确说是学习项目，不要编造生产数据。

## 证据限制

公开面经不是随机抽样，热门公司和愿意发帖的候选人会被过度代表。有的帖子还存在推广、二次加工或公司标注冲突，题库已通过来源备注和权重降低处理，但不能完全消除噪声。站内分数只用于决定学习先后，不能理解为“面试出现概率”。

完整来源及备注位于 `research/sources.json`，计算规则位于 `docs/METHODOLOGY.md`。
