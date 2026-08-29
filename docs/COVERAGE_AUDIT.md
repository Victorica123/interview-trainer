# Java 后端八股目录覆盖审计

审计日期：2026-08-28。

## 审计目标

本次审计回答三个不同问题：

1. 主流 Java 后端八股目录中的稳定知识结构是否覆盖；
2. 近期公开面经和热门题库中反复出现的缺口是否补齐；
3. 学习资料、用户关注度与直接面经是否被正确分开，避免把“网站有这一章”误算成“近期面试高频”。

项目不复制第三方网站题库，也不声称统计了牛客、小红书或互联网的全部帖子。覆盖率仅针对 Java 后端八股范围；算法题、前端题和 HR 行为题不在本次范围内。

## 对照来源

### 主流学习目录

- [JavaGuide：Java 面试重点](https://interview.javaguide.cn/interview-preparation/key-points-of-interview.html)：Java 基础/新特性、集合、并发、JVM、Spring、MySQL、Redis、网络、操作系统、Linux、MQ、高性能、高可用、分布式、微服务、系统设计和设计模式。
- [小林 coding 首页](https://xiaolincoding.com/)与[面试目录](https://xiaolincoding.com/interview/)：计算机基础、Java、MySQL、Redis、网络、操作系统、消息队列、系统设计、设计模式及 Netty 等进阶内容。
- [面试鸭近 30 天热门榜](https://www.mianshiya.com/hot/question_bank)与[Java 热门 200 题](https://www.mianshiya.com/bank/1860871861809897474)：用于观察用户关注度和核对具体缺口，不作为直接面经频率。

### 近期直接信号

- [牛客：2026 Java 工程场景趋势](https://www.nowcoder.com/discuss/919547742072897536)：明确提到 Java 21 虚拟线程关注度上升及 I/O 密集场景。
- [牛客：阿里淘天 Java 一面](https://www.nowcoder.com/discuss/874219579965259776)：包含 Spring 事务失效等直接追问。
- [牛客：字节 Java 二面](https://www.nowcoder.com/discuss/860815475284955136)：包含分布式事务、服务治理、API 网关/CDN 等工程话题。

另参考[牛客 Java 高频核心题整理](https://www.nowcoder.com/discuss/919268328370077696)交叉核对 JIT/逃逸分析与 Spring 事务传播。该页面属于整理指南而非单次直接面经，因此不参与趋势计数。

## 面试鸭公开热度快照

2026-08-29 重筛的近 30 天公开榜中，Java 后端与 AI / Agent 相关题库包括：

| 排名 | 题库 | 页面热度 |
| ---: | --- | ---: |
| 1 | AI Agent 智能体面试题 | 5.1k |
| 2 | Java 热门 200 题 | 2.6k |
| 3 | 最全 AI 大模型面试题库 | 2.1k |
| 5 | Java 基础 | 1.8k |
| 6 | MySQL | 1.8k |
| 7 | Redis | 1.4k |
| 9 | Java 并发 | 1.0k |
| 10 | Java 集合 | 982 |
| 11 | 计算机网络 | 952 |
| 13 | Spring Boot | 921 |
| 14 | 后端场景 | 896 |
| 16 | Spring | 829 |
| 17 | JVM | 827 |
| 18 | 系统设计 | 768 |
| 20 | 消息队列 | 762 |
| 22 | 操作系统 | 743 |
| 23 | Spring Cloud | 732 |
| 26 | 设计模式 | 615 |

本次完整保存上述三个综合题库的 620 个公开标题（Agent 50、Java 200、大模型 370）和 TOP50 题库元数据。620 个标题中，559 个属于当前 Java 后端与 AI / Agent 应用范围，已全部映射到现有知识点；61 个传统 NLP、特定产品内部细节或缺少上下文的标题明确排除，不用猜测补齐。范围内映射覆盖率为 100%。

这些数字只表示榜单页面当时公开的用户关注信号，不等于真实面试出现次数。生成器把它作为独立、低置信且最多 2 分的 publicQuestionAttention：同题库同标题去重、同知识点每个题库只贡献一次，不能增加面经样本数或制造“近期上升”结论。VIP 题只读取公开题目标题和列表链接，不访问或推断答案。

## 覆盖结果

补齐前：107 个后端知识点、535 道后端题、795 道总题。

补齐后：145 个后端知识点、725 道后端题、985 道总题；来源登记从 43 项增加到 51 项。38 个新增后端知识点全部追加到动态目录末尾，旧题 ID 未改变。

| 同级专题 | 知识点 | 题目 | 本次重点补齐 |
| --- | ---: | ---: | --- |
| Java基础 | 15 | 75 | JDK/JRE/JVM、包装类型/BigDecimal、SPI、Java 8–21 |
| Java集合 | 9 | 45 | fail-fast、BlockingQueue、Queue/Deque/PriorityQueue |
| Java并发 | 14 | 70 | CompletableFuture、同步器、Java 21 虚拟线程 |
| JVM | 7 | 35 | 对象布局/指针压缩、JIT/逃逸分析 |
| Spring生态 | 14 | 70 | Bean 作用域/线程安全、事务传播/回滚/失效 |
| MySQL | 16 | 80 | 存储引擎/字段、Buffer Pool/Change Buffer、深分页 |
| Redis | 11 | 55 | 事务/Lua/Pipeline、跳表与概率结构 |
| 计算机网络 | 11 | 55 | TCP/UDP/粘包拆包、TLS、IP/ARP/ICMP |
| 操作系统与Linux | 7 | 35 | 用户态/系统调用、IPC/调度、inode/文件描述符 |
| 消息队列 | 9 | 45 | 积压/重试/死信、Kafka ISR/Rebalance/EOS、RocketMQ 事务/延时 |
| 分布式与微服务 | 13 | 65 | Raft/Paxos/ZAB、API 网关/配置中心、Transactional Outbox |
| 系统设计与场景 | 19 | 95 | 容量/SLA、Nginx/CDN、Netty、设计模式、Docker、Elasticsearch |

每个知识点固定生成五类可独立训练的问题：定义、机制、项目应用、故障排查和对比选型。题量增长来自知识点覆盖，而不是把同一个题干做五次近义改写。

## 自动回归约束

`scripts/test-coverage.mjs` 固定了三家主流目录中 123 个 Java 后端必备检查项，覆盖 12 个专题。测试要求：

- 每个检查项必须映射到题库中的明确知识点；
- 必须归入正确的同级专题；
- 必须拥有五类问法和非空答案；
- JavaGuide、小林 coding 和面试鸭审计来源必须存在；
- 面试鸭保持 `guide` 类型且 `directQuestionEvidence: false`；
- guide、official、research 来源不能获得趋势频率资格。
- 公开标题快照必须保持 620 个唯一题库题目记录、范围内映射覆盖率至少 99%，关注度加分不超过 2，并证明面经频次字段完全不变。

运行：

```bash
npm run test:coverage
npm run test:public-signals
```

这使“主流目录覆盖”成为可回归的发布条件，而不是 README 中无法验证的口号。

## 高频与学习资料的边界

题库来源字段承担两种不同职责：

- `evidence.sourceIds`：解释为什么收录、如何排序；只有满足链接、日期、直接问题证据和采集要求的面经才可进入趋势频率。
- `learningSourceIds` / `learningHints`：提供官方文档和八股章节作为学习入口，不增加近期面经样本数。

面试鸭热门榜提供用户关注度，小林 coding 与 JavaGuide提供知识目录，OpenJDK/Redis/RFC/Netty/NGINX/Docker/Elastic 等官方资料负责事实核对。三类信号不会混成一个“高频”数字。

## 仍需持续维护的部分

- 公开面经不是随机抽样，热门公司、愿意发帖的人和可公开访问页面会被过度代表。
- 当前可审计面经主要托管在牛客；小红书平台内容的全站统计不可由本项目可靠完成，因此不作覆盖声明。
- 框架、协议和云产品会持续变化，需要在后续更新中用官方文档复核；新增题默认是提纲版，只有显式登记才显示为人工已复核。
- 算法与数据结构编码题未来可作为独立训练轨道加入，不应与本次 Java 后端八股目录覆盖率混算。
