export const QUESTION_ANGLES = [
  { id: "definition", name: "概念定义" },
  { id: "mechanism", name: "原理机制" },
  { id: "application", name: "项目应用" },
  { id: "pitfall", name: "故障排查" },
  { id: "comparison", name: "对比选型" }
];

// 目录参考主流 Java 八股站点的同级专题结构；知识点顺序仍由 catalog 决定，
// 这里仅维护展示分类，不能用于重排题目或生成题目 ID。
export const BACKEND_TAXONOMY = [
  {
    name: "Java基础",
    groups: [
      { name: "运行环境与字节码", concepts: ["JDK、JRE、JVM与字节码", "SPI与ServiceLoader"] },
      { name: "基础类型", concepts: ["基本类型、包装类型与BigDecimal"] },
      { name: "现代Java", concepts: ["Java 8到21核心新特性"] },
      { name: "面向对象与设计", concepts: ["面向对象与SOLID", "不可变对象与防御性复制", "接口与抽象类"] },
      { name: "字符串与对象契约", concepts: ["String不可变与字符串常量池", "equals与hashCode契约"] },
      { name: "异常处理", concepts: ["Java异常体系"] },
      { name: "泛型", concepts: ["泛型与类型擦除"] },
      { name: "反射与注解", concepts: ["反射与注解"] },
      { name: "序列化", concepts: ["Java序列化"] },
      { name: "I/O", concepts: ["Java IO、NIO与零拷贝"] },
      { name: "函数式编程", concepts: ["Stream与Lambda"] }
    ]
  },
  {
    name: "Java集合",
    groups: [
      { name: "List与队列", concepts: ["ArrayList", "LinkedList与双端队列"] },
      { name: "迭代与队列", concepts: ["集合迭代与fail-fast", "BlockingQueue与生产者消费者", "Queue、Deque与PriorityQueue"] },
      { name: "Map", concepts: ["HashMap", "ConcurrentHashMap", "TreeMap与红黑树"] },
      { name: "Set与去重", concepts: ["HashSet与集合去重"] }
    ]
  },
  {
    name: "Java并发",
    groups: [
      { name: "线程基础", concepts: ["Java线程状态"] },
      { name: "异步编排", concepts: ["CompletableFuture与异步编排"] },
      { name: "同步器", concepts: ["CountDownLatch、Semaphore与CyclicBarrier"] },
      { name: "虚拟线程", concepts: ["Java虚拟线程"] },
      { name: "Java内存模型与无锁并发", concepts: ["volatile与Java内存模型", "CAS与ABA问题"] },
      { name: "锁与同步器", concepts: ["synchronized与锁升级", "AQS", "ReentrantLock与Condition", "死锁与活锁"] },
      { name: "线程池", concepts: ["ThreadPoolExecutor", "线程池", "动态线程池"] },
      { name: "线程上下文", concepts: ["ThreadLocal"] }
    ]
  },
  {
    name: "JVM",
    groups: [
      { name: "运行时内存", concepts: ["JVM运行时内存区域"] },
      { name: "对象与执行引擎", concepts: ["Java对象创建、内存布局与指针压缩", "JIT编译、逃逸分析与分层优化"] },
      { name: "垃圾回收", concepts: ["垃圾判定与GC算法", "G1与ZGC"] },
      { name: "类加载", concepts: ["类加载与双亲委派"] },
      { name: "内存故障与调优", concepts: ["线上OOM与内存泄漏排查"] }
    ]
  },
  {
    name: "Spring生态",
    groups: [
      { name: "容器与Bean", concepts: ["Spring IoC与依赖注入", "Spring Bean生命周期", "Spring循环依赖与三级缓存", "Spring Bean作用域与线程安全"] },
      { name: "AOP与事务", concepts: ["Spring AOP与动态代理", "Spring声明式事务", "Spring事务传播、回滚与失效"] },
      { name: "Spring Boot", concepts: ["Spring Boot自动配置", "Spring Boot启动流程"] },
      { name: "Web与安全", concepts: ["Spring MVC请求流程", "Spring Security与JWT认证"] },
      { name: "持久层", concepts: ["MyBatis执行流程与缓存"] },
      { name: "微服务治理", concepts: ["Spring Cloud服务治理"] },
      { name: "任务调度", concepts: ["异步任务与定时任务"] }
    ]
  },
  {
    name: "MySQL",
    groups: [
      { name: "SQL执行与存储引擎", concepts: ["一条SQL的执行流程"] },
      { name: "存储引擎与字段", concepts: ["InnoDB、MyISAM与字段设计", "InnoDB Buffer Pool与Change Buffer"] },
      { name: "索引", concepts: ["B+树索引", "聚簇索引与回表", "联合索引与最左前缀", "索引失效与优化器选择"] },
      { name: "性能调优", concepts: ["Explain与慢SQL排查", "深分页与大表查询优化"] },
      { name: "事务与MVCC", concepts: ["事务ACID", "事务隔离级别", "MVCC与Read View"] },
      { name: "锁", concepts: ["InnoDB锁与死锁"] },
      { name: "日志", concepts: ["redo log、undo log与binlog"] },
      { name: "复制与分片", concepts: ["主从复制与读写分离", "分库分表与分布式ID"] }
    ]
  },
  {
    name: "Redis",
    groups: [
      { name: "数据结构", concepts: ["Redis数据类型与底层编码", "Redis跳表与概率数据结构"] },
      { name: "事务与脚本", concepts: ["Redis事务、Lua与Pipeline"] },
      { name: "线程与网络模型", concepts: ["Redis高性能与事件循环"] },
      { name: "持久化", concepts: ["RDB、AOF与混合持久化"] },
      { name: "过期与淘汰", concepts: ["过期删除与内存淘汰"] },
      { name: "缓存问题", concepts: ["缓存穿透、击穿与雪崩"] },
      { name: "数据一致性", concepts: ["缓存与数据库一致性"] },
      { name: "分布式锁", concepts: ["Redis分布式锁"] },
      { name: "高可用与集群", concepts: ["Redis主从、哨兵与Cluster"] },
      { name: "内存与热点诊断", concepts: ["BigKey、HotKey与内存诊断"] }
    ]
  },
  {
    name: "计算机网络",
    groups: [
      { name: "TCP", concepts: ["TCP三次握手", "TCP四次挥手", "TCP可靠传输与拥塞控制"] },
      { name: "传输层", concepts: ["TCP与UDP及粘包拆包"] },
      { name: "网络层", concepts: ["IP、ARP与ICMP"] },
      { name: "HTTP与Web", concepts: ["HTTP与HTTPS", "HTTP/1.1、HTTP/2与HTTP/3", "DNS解析与URL访问全过程", "Cookie、Session与JWT", "TLS握手与证书校验"] },
      { name: "服务通信", concepts: ["REST、RPC、WebSocket与SSE"] }
    ]
  },
  {
    name: "操作系统与Linux",
    groups: [
      { name: "进程与线程", concepts: ["进程、线程与协程", "进程通信、调度与上下文切换"] },
      { name: "内核与文件系统", concepts: ["用户态、内核态与系统调用", "文件系统、inode与文件描述符"] },
      { name: "内存管理", concepts: ["虚拟内存与分页"] },
      { name: "I/O模型", concepts: ["I/O模型与epoll"] },
      { name: "Linux线上排查", concepts: ["Linux线上排查工具"] }
    ]
  },
  {
    name: "消息队列",
    groups: [
      { name: "核心模型与场景", concepts: ["消息队列的异步、解耦与削峰"] },
      { name: "可靠投递", concepts: ["消息可靠投递", "消息积压、重试与死信队列"] },
      { name: "Kafka", concepts: ["Kafka副本ISR、Rebalance与Exactly Once"] },
      { name: "事务与延时", concepts: ["RocketMQ事务消息与延时消息"] },
      { name: "重复消费与幂等", concepts: ["重复消费与幂等"] },
      { name: "消息顺序", concepts: ["消息顺序与分区", "消息顺序性"] },
      { name: "产品选型", concepts: ["Kafka、RabbitMQ与RocketMQ"] }
    ]
  },
  {
    name: "分布式与微服务",
    groups: [
      { name: "一致性理论", concepts: ["CAP与BASE", "最终一致性与对账"] },
      { name: "共识与网关", concepts: ["Raft、Paxos与ZAB共识", "API网关与配置中心"] },
      { name: "分布式事务", concepts: ["分布式事务", "Transactional Outbox与可靠事件"] },
      { name: "数据路由", concepts: ["一致性哈希"] },
      { name: "服务治理", concepts: ["服务发现与负载均衡", "限流、熔断与降级", "分布式限流"] },
      { name: "幂等设计", concepts: ["接口幂等设计"] },
      { name: "微服务拆分", concepts: ["微服务拆分"] },
      { name: "可观测性", concepts: ["可观测性与链路追踪"] }
    ]
  },
  {
    name: "系统设计与场景",
    groups: [
      { name: "高并发系统", concepts: ["秒杀系统", "热点数据与多级缓存", "排行榜设计"] },
      { name: "容量与基础设施", concepts: ["容量估算、压测与SLA", "Nginx、CDN与负载均衡", "Netty Reactor与高性能网络", "Docker容器与JVM部署"] },
      { name: "设计模式", concepts: ["单例、工厂与策略模式", "代理、模板与责任链模式"] },
      { name: "搜索与数据平台", concepts: ["Elasticsearch倒排索引与搜索"] },
      { name: "业务流程", concepts: ["订单超时关闭", "支付回调系统"] },
      { name: "身份与会话", concepts: ["分布式登录态"] },
      { name: "数据与存储设计", concepts: ["短链系统", "百万数据导入导出"] },
      { name: "性能与故障排查", concepts: ["接口延迟突增排查", "CPU 100%与OOM排查"] },
      { name: "高可用与容灾", concepts: ["高可用与容灾"] },
      { name: "项目表达", concepts: ["项目介绍与量化验证"] }
    ]
  }
];

const backendConceptTaxonomy = new Map();
for (const category of BACKEND_TAXONOMY) {
  for (const group of category.groups) {
    for (const concept of group.concepts) {
      if (backendConceptTaxonomy.has(concept)) throw new Error(`后端知识点分类重复：${concept}`);
      backendConceptTaxonomy.set(concept, { category: category.name, topicGroup: group.name });
    }
  }
}

export const BACKEND_CATEGORY_NAMES = BACKEND_TAXONOMY.map((category) => category.name);

export function migrateLegacyBackendCategory(name, category = "", topicGroup = "", tags = []) {
  if (BACKEND_CATEGORY_NAMES.includes(category)) return { category, topicGroup: String(topicGroup || "其他").trim() || "其他" };
  const terms = `${name} ${(tags || []).join(" ")}`;
  if (category === "计算机基础") {
    return { category: /进程|线程|协程|虚拟内存|分页|epoll|I\/O模型|Linux|操作系统/.test(terms) ? "操作系统与Linux" : "计算机网络", topicGroup: "其他" };
  }
  if (category === "Java基础与集合") {
    return { category: /List|Map|Set|集合|队列|红黑树|Hash/.test(terms) ? "Java集合" : "Java基础", topicGroup: "其他" };
  }
  if (category === "并发与JVM") {
    return { category: /JVM|GC|垃圾回收|类加载|OOM|内存泄漏|运行时内存/.test(terms) ? "JVM" : "Java并发", topicGroup: "其他" };
  }
  if (category === "分布式系统") return { category: "分布式与微服务", topicGroup: "其他" };
  return { category: "系统设计与场景", topicGroup: String(topicGroup || "其他").trim() || "其他" };
}

export function classifyBackendConcept(name, category = "", topicGroup = "") {
  const classified = backendConceptTaxonomy.get(name);
  if (classified) return classified;
  return migrateLegacyBackendCategory(name, category, topicGroup);
}

export function backendTaxonomyEntry(name) {
  return backendConceptTaxonomy.get(name) || null;
}
