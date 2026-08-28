import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildPayload } from "./generate-questions.mjs";

// 2026-08-28 对照 JavaGuide、小林 coding 和面试鸭公开目录整理。
// 每项代表主流 Java 后端八股目录中的一个稳定考察面；保留这份清单，避免后续更新误删覆盖。
const REQUIRED_COVERAGE = {
  "Java基础": [
    "JDK、JRE、JVM与字节码", "基本类型、包装类型与BigDecimal", "面向对象与SOLID",
    "String不可变与字符串常量池", "Java异常体系", "泛型与类型擦除", "反射与注解",
    "Java IO、NIO与零拷贝", "SPI与ServiceLoader", "Java 8到21核心新特性"
  ],
  "Java集合": [
    "ArrayList", "LinkedList与双端队列", "HashMap", "ConcurrentHashMap", "TreeMap与红黑树",
    "集合迭代与fail-fast", "BlockingQueue与生产者消费者", "Queue、Deque与PriorityQueue"
  ],
  "Java并发": [
    "Java线程状态", "volatile与Java内存模型", "CAS与ABA问题", "synchronized与锁升级", "AQS",
    "ReentrantLock与Condition", "ThreadPoolExecutor", "ThreadLocal", "死锁与活锁",
    "CompletableFuture与异步编排", "CountDownLatch、Semaphore与CyclicBarrier", "Java虚拟线程"
  ],
  "JVM": [
    "JVM运行时内存区域", "垃圾判定与GC算法", "G1与ZGC", "类加载与双亲委派",
    "线上OOM与内存泄漏排查", "Java对象创建、内存布局与指针压缩", "JIT编译、逃逸分析与分层优化"
  ],
  "Spring生态": [
    "Spring IoC与依赖注入", "Spring Bean生命周期", "Spring Bean作用域与线程安全",
    "Spring AOP与动态代理", "Spring声明式事务", "Spring事务传播、回滚与失效",
    "Spring Boot自动配置", "Spring Boot启动流程", "Spring MVC请求流程", "MyBatis执行流程与缓存",
    "Spring Security与JWT认证", "Spring Cloud服务治理"
  ],
  "MySQL": [
    "一条SQL的执行流程", "InnoDB、MyISAM与字段设计", "InnoDB Buffer Pool与Change Buffer",
    "B+树索引", "聚簇索引与回表", "联合索引与最左前缀", "Explain与慢SQL排查",
    "深分页与大表查询优化", "事务ACID", "事务隔离级别", "MVCC与Read View",
    "InnoDB锁与死锁", "redo log、undo log与binlog", "主从复制与读写分离", "分库分表与分布式ID"
  ],
  "Redis": [
    "Redis数据类型与底层编码", "Redis跳表与概率数据结构", "Redis事务、Lua与Pipeline",
    "Redis高性能与事件循环", "RDB、AOF与混合持久化", "过期删除与内存淘汰",
    "缓存穿透、击穿与雪崩", "缓存与数据库一致性", "Redis分布式锁",
    "Redis主从、哨兵与Cluster", "BigKey、HotKey与内存诊断"
  ],
  "计算机网络": [
    "TCP三次握手", "TCP四次挥手", "TCP可靠传输与拥塞控制", "TCP与UDP及粘包拆包",
    "HTTP与HTTPS", "HTTP/1.1、HTTP/2与HTTP/3", "TLS握手与证书校验",
    "DNS解析与URL访问全过程", "IP、ARP与ICMP", "REST、RPC、WebSocket与SSE"
  ],
  "操作系统与Linux": [
    "进程、线程与协程", "用户态、内核态与系统调用", "进程通信、调度与上下文切换",
    "虚拟内存与分页", "I/O模型与epoll", "文件系统、inode与文件描述符", "Linux线上排查工具"
  ],
  "消息队列": [
    "消息队列的异步、解耦与削峰", "消息可靠投递", "消息积压、重试与死信队列",
    "重复消费与幂等", "消息顺序与分区", "Kafka副本ISR、Rebalance与Exactly Once",
    "RocketMQ事务消息与延时消息", "Kafka、RabbitMQ与RocketMQ"
  ],
  "分布式与微服务": [
    "CAP与BASE", "Raft、Paxos与ZAB共识", "分布式事务", "Transactional Outbox与可靠事件",
    "一致性哈希", "服务发现与负载均衡", "限流、熔断与降级", "API网关与配置中心",
    "接口幂等设计", "微服务拆分", "可观测性与链路追踪"
  ],
  "系统设计与场景": [
    "容量估算、压测与SLA", "Nginx、CDN与负载均衡", "Netty Reactor与高性能网络",
    "单例、工厂与策略模式", "代理、模板与责任链模式", "Docker容器与JVM部署",
    "Elasticsearch倒排索引与搜索", "秒杀系统", "热点数据与多级缓存",
    "接口延迟突增排查", "CPU 100%与OOM排查", "高可用与容灾"
  ]
};

const payload = await buildPayload();
const backendQuestions = payload.questions.filter((question) => question.track === "backend");
const concepts = new Map();
for (const question of backendQuestions) {
  const current = concepts.get(question.concept) || { category: question.category, questions: [] };
  current.questions.push(question);
  concepts.set(question.concept, current);
}

for (const [category, requiredConcepts] of Object.entries(REQUIRED_COVERAGE)) {
  for (const name of requiredConcepts) {
    const concept = concepts.get(name);
    assert.ok(concept, `${category} 缺少主流目录知识点：${name}`);
    assert.equal(concept.category, category, `${name} 被归入错误专题`);
    assert.equal(concept.questions.length, 5, `${name} 未覆盖五类问法`);
    assert.ok(concept.questions.every((question) => question.quickAnswer.length >= 18), `${name} 存在过短答案`);
  }
}

const sources = JSON.parse(await readFile(new URL("../research/sources.json", import.meta.url), "utf8"));
const sourceMap = new Map(sources.sources.map((source) => [source.id, source]));
for (const id of ["javaguide-priority-2026", "xiaolin-backend-2026", "mianshiya-hot-2026"]) {
  assert.ok(sourceMap.has(id), `缺少目录审计来源 ${id}`);
}
assert.equal(sourceMap.get("mianshiya-hot-2026").type, "guide");
assert.equal(sourceMap.get("mianshiya-hot-2026").directQuestionEvidence, false);
assert.ok(sources.sources.filter((source) => ["guide", "official", "research"].includes(source.type))
  .every((source) => source.collection?.frequencyEligible !== true), "学习资料不能计入面经趋势频率");

const requiredCount = Object.values(REQUIRED_COVERAGE).reduce((sum, names) => sum + names.length, 0);
console.log(`Coverage regression passed: ${requiredCount} mainstream checklist items across 12 backend topics, all with five question angles.`);
