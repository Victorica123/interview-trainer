import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export function normalizeSignalText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/spring\s*boot/g, "springboot")
    .replace(/fine\s*[- ]?tuning/g, "finetuning")
    .replace(/function\s*calling/g, "functioncalling")
    .replace(/tool\s*calling/g, "toolcalling")
    .replace(/multi\s*[- ]?agent/g, "multiagent")
    .replace(/[^\p{Letter}\p{Number}+#]+/gu, "");
}

const GENERIC_TERMS = new Set([
  "agent", "ai", "llm", "rag", "mcp", "api", "java", "mysql", "redis", "spring", "springboot", "langchain",
  "tcp", "http", "jvm", "mq", "sql", "gc",
  "模型", "大模型", "智能体", "系统", "项目", "应用", "框架", "原理", "流程", "架构",
  "性能", "问题", "数据", "工具", "接口", "并发", "内存", "线程", "网络", "数据库",
  "索引", "事务", "缓存", "消息", "安全", "评测", "部署", "检索", "向量", "提示词",
  "设计原则", "优化器", "持久化", "分布式锁"
].map(normalizeSignalText));

const MANUAL_ALIASES = {
  "TCP三次握手": ["三次握手"],
  "TCP四次挥手": ["四次挥手", "time_wait"],
  "TCP可靠传输与拥塞控制": ["超时重传", "滑动窗口", "拥塞控制", "tcp连接"],
  "HTTP与HTTPS": ["http和https", "http与https", "https证书"],
  "HTTP/1.1、HTTP/2与HTTP/3": ["http1.0和2.0", "http1.1", "http2.0", "http3.0", "http/2", "http/3"],
  "DNS解析与URL访问全过程": ["输入网址", "输入url", "网页显示", "dns解析"],
  "Cookie、Session与JWT": ["cookie session token", "cookie、session、token", "登录态", "jwt"],
  "进程、线程与协程": ["线程和进程", "进程和线程", "协程"],
  "虚拟内存与分页": ["物理地址", "逻辑地址", "虚拟内存"],
  "I/O模型与epoll": ["io模型", "i/o模型", "select、poll、epoll", "select poll epoll"],
  "Linux线上排查工具": ["linux命令", "linux排查"],
  "REST、RPC、WebSocket与SSE": ["http与rpc", "rpc框架", "websocket", "sse"],
  "面向对象与SOLID": ["面向对象", "solid原则"],
  "String不可变与字符串常量池": ["string不可变", "字符串常量池"],
  "equals与hashCode契约": ["equals", "hashcode"],
  "ArrayList": ["arraylist", "数组和链表"],
  "LinkedList与双端队列": ["linkedlist", "双端队列"],
  "HashMap": ["hashmap", "负载因子"],
  "ConcurrentHashMap": ["concurrenthashmap"],
  "TreeMap与红黑树": ["treemap", "红黑树"],
  "HashSet与集合去重": ["hashset", "集合去重"],
  "Java异常体系": ["java异常", "checkedexception", "runtimeexception"],
  "泛型与类型擦除": ["类型擦除", "java泛型"],
  "反射与注解": ["java反射", "java注解"],
  "Java序列化": ["java序列化", "serializable"],
  "Java IO、NIO与零拷贝": ["java nio", "零拷贝"],
  "Stream与Lambda": ["stream流", "lambda"],
  "Java线程状态": ["线程状态", "线程生命周期"],
  "synchronized与锁升级": ["synchronized", "偏向锁", "轻量级锁", "锁升级"],
  "volatile与Java内存模型": ["volatile", "java内存模型", "jmm", "原子性可见性有序性"],
  "CAS与ABA问题": ["compare-and-swap", "cas操作", "aba问题"],
  "AQS": ["aqs"],
  "ReentrantLock与Condition": ["reentrantlock", "condition"],
  "ThreadPoolExecutor": ["threadpoolexecutor", "线程池原理", "线程池拒绝策略", "线程池线程数"],
  "ThreadLocal": ["threadlocal"],
  "死锁与活锁": ["java死锁", "导致死锁"],
  "JVM运行时内存区域": ["jvm内存区域", "jvm由哪些部分", "元空间", "永久代"],
  "垃圾判定与GC算法": ["垃圾回收算法", "垃圾回收器", "垃圾收集器", "可达性分析"],
  "G1与ZGC": ["g1", "zgc", "垃圾回收调优", "gc调优"],
  "类加载与双亲委派": ["类加载", "双亲委派"],
  "线上OOM与内存泄漏排查": ["oom", "内存泄漏", "jvm内存占用"],
  "Spring IoC与依赖注入": ["spring ioc", "ioc容器", "依赖注入"],
  "Spring Bean生命周期": ["bean生命周期"],
  "Spring AOP与动态代理": ["spring aop", "动态代理", "什么是aop"],
  "Spring声明式事务": ["spring事务"],
  "Spring循环依赖与三级缓存": ["循环依赖", "三级缓存"],
  "Spring Boot自动配置": ["spring boot自动配置", "springboot自动配置", "starter"],
  "Spring MVC请求流程": ["spring mvc", "dispatcherservlet"],
  "MyBatis执行流程与缓存": ["mybatis", "mybatis-plus"],
  "Spring Security与JWT认证": ["spring security"],
  "Spring Cloud服务治理": ["spring cloud", "dubbo和spring cloud"],
  "异步任务与定时任务": ["定时任务", "异步任务"],
  "一条SQL的执行流程": ["一条sql", "sql语句在mysql", "count(*)", "select *"],
  "B+树索引": ["b+树", "b树索引"],
  "聚簇索引与回表": ["聚簇索引", "非聚簇索引", "覆盖索引", "回表"],
  "联合索引与最左前缀": ["最左前缀", "联合索引"],
  "索引失效与优化器选择": ["索引失效", "索引下推", "索引数量", "使用索引一定有效"],
  "Explain与慢SQL排查": ["explain", "sql调优", "慢sql"],
  "事务ACID": ["acid", "mysql如何实现事务", "长事务"],
  "事务隔离级别": ["隔离级别", "脏读", "不可重复读", "幻读"],
  "MVCC与Read View": ["mvcc", "read view"],
  "InnoDB锁与死锁": ["mysql锁", "乐观锁", "悲观锁", "mysql死锁"],
  "redo log、undo log与binlog": ["redo log", "undo log", "binlog", "二阶段提交"],
  "主从复制与读写分离": ["主从同步", "主从复制", "主从延迟", "读写分离"],
  "分库分表与分布式ID": ["分库分表", "分布式id", "发号器"],
  "InnoDB、MyISAM与字段设计": ["存储引擎", "innodb和myisam", "innodb、myisam"],
  "InnoDB Buffer Pool与Change Buffer": ["buffer pool", "change buffer"],
  "深分页与大表查询优化": ["深度分页", "深分页", "大表查询"],
  "Redis数据类型与底层编码": ["redis数据类型", "redis的hash", "redis底层数据结构"],
  "Redis高性能与事件循环": ["redis为什么这么快", "redis单线程", "redis性能瓶颈"],
  "RDB、AOF与混合持久化": ["rdb", "aof", "redis持久化"],
  "过期删除与内存淘汰": ["过期删除", "删除策略", "内存淘汰"],
  "缓存穿透、击穿与雪崩": ["缓存穿透", "缓存击穿", "缓存雪崩"],
  "缓存与数据库一致性": ["缓存与数据库", "缓存和数据库", "数据一致性"],
  "Redis分布式锁": ["redis分布式锁", "redisson"],
  "Redis主从、哨兵与Cluster": ["redis集群", "redis哨兵", "redis脑裂"],
  "BigKey、HotKey与内存诊断": ["big key", "bigkey", "hot key", "hotkey", "热点key", "redis内存溢出", "redis机器爆"],
  "Redis事务、Lua与Pipeline": ["redis事务", "lua脚本", "pipeline"],
  "Redis跳表与概率数据结构": ["redis跳表", "布隆过滤器", "hyperloglog"],
  "消息队列的异步、解耦与削峰": ["为什么需要消息队列", "消息队列模型", "推消息还是拉消息"],
  "消息可靠投递": ["消息不丢失", "可靠投递", "消息丢失"],
  "重复消费与幂等": ["重复消息", "重复消费", "消息幂等"],
  "消息顺序与分区": ["消息有序", "消息顺序", "顺序消息"],
  "Kafka、RabbitMQ与RocketMQ": ["kafka", "rabbitmq", "rocketmq", "nameserver", "zookeeper"],
  "消息积压、重试与死信队列": ["消息堆积", "消息积压", "延迟队列", "死信", "无法路由"],
  "Kafka副本ISR、Rebalance与Exactly Once": ["kafka副本", "isr", "rebalance", "exactly once"],
  "RocketMQ事务消息与延时消息": ["rocketmq事务消息", "rocketmq延时"],
  "CAP与BASE": ["cap理论", "base理论"],
  "分布式事务": ["分布式事务", "tcc", "saga", "2pc"],
  "一致性哈希": ["一致性哈希"],
  "服务发现与负载均衡": ["服务发现", "负载均衡算法", "注册中心"],
  "限流、熔断与降级": ["服务熔断", "服务降级", "服务雪崩"],
  "接口幂等设计": ["接口幂等"],
  "最终一致性与对账": ["最终一致性", "对账"],
  "微服务拆分": ["微服务拆分"],
  "可观测性与链路追踪": ["链路追踪", "可观测性"],
  "API网关与配置中心": ["api网关", "配置中心"],
  "Raft、Paxos与ZAB共识": ["raft", "paxos", "zab"],
  "秒杀系统": ["秒杀"],
  "订单超时关闭": ["订单超时"],
  "支付回调系统": ["支付回调"],
  "分布式登录态": ["分布式登录", "session共享"],
  "短链系统": ["短链"],
  "热点数据与多级缓存": ["多级缓存", "热点数据"],
  "接口延迟突增排查": ["接口延迟", "接口变慢"],
  "CPU 100%与OOM排查": ["cpu飙高", "cpu 100", "cpu100"],
  "高可用与容灾": ["高可用", "容灾"],
  "Nginx、CDN与负载均衡": ["nginx", "cdn"],
  "Netty Reactor与高性能网络": ["netty", "reactor线程模型", "空轮询"],
  "单例、工厂与策略模式": ["单例模式", "工厂模式", "策略模式", "观察者模式", "设计模式"],
  "代理、模板与责任链模式": ["代理模式", "模板方法", "责任链模式"],
  "Docker容器与JVM部署": ["docker", "容器化"],
  "Elasticsearch倒排索引与搜索": ["elasticsearch", "倒排索引"]
};

// Java/backend wording that differs from the canonical concept names.
Object.assign(MANUAL_ALIASES, {
  "ArrayList": [...MANUAL_ALIASES.ArrayList, "集合类"],
  "Java线程状态": [...MANUAL_ALIASES.Java线程状态, "创建多线程"],
  "volatile与Java内存模型": [...MANUAL_ALIASES["volatile与Java内存模型"], "final关键字", "原子性、可见性和有序性"],
  "synchronized与锁升级": [...MANUAL_ALIASES["synchronized与锁升级"], "优化java中的锁"],
  "Spring IoC与依赖注入": [...MANUAL_ALIASES["Spring IoC与依赖注入"], "spring中的di"],
  "Spring Boot启动流程": ["spring启动过程", "springboot启动流程", "main方法启动web", "springboot核心特性", "什么是springboot"],
  "Redis数据类型与底层编码": [...MANUAL_ALIASES["Redis数据类型与底层编码"], "常见的数据类型", "redis应用场景", "redis和memcached"],
  "Redis主从、哨兵与Cluster": [...MANUAL_ALIASES["Redis主从、哨兵与Cluster"], "哨兵机制"],
  "Redis分布式锁": [...MANUAL_ALIASES["Redis分布式锁"], "分布式锁一般"],
  "Redis事务、Lua与Pipeline": [...MANUAL_ALIASES["Redis事务、Lua与Pipeline"], "redis支持事务"],
  "IP、ARP与ICMP": ["osi七层", "tcp/ip四层", "网络分层模型"],
  "索引失效与优化器选择": [...MANUAL_ALIASES["索引失效与优化器选择"], "不推荐为数据库建立索引"],
  "分布式事务": [...MANUAL_ALIASES["分布式事务"], "seata"],
  "限流、熔断与降级": [...MANUAL_ALIASES["限流、熔断与降级"], "限流算法"],
  "热点数据与多级缓存": [...MANUAL_ALIASES["热点数据与多级缓存"], "点赞系统"]
});

// Applied AI/Agent base terms.
Object.assign(MANUAL_ALIASES, {
  "Token与上下文窗口": ["token", "context window", "上下文窗口"],
  "Transformer与自注意力": ["transformer", "self attention", "self-attention", "自注意力", "多头注意力", "attention mask", "位置编码", "残差连接", "layer normalization"],
  "温度、Top-p与采样": ["temperature", "top_p", "top-p", "采样参数"],
  "结构化输出与Schema": ["结构化输出", "outputparser", "指定格式", "json输出"],
  "流式响应、限流与重试": ["流式输出", "流式响应", "模型限流"],
  "消息角色与Prompt模板": ["prompt模板", "提示词模板", "system prompt", "系统提示词", "角色扮演", "role playing"],
  "上下文工程": ["上下文工程", "上下文压缩", "context compaction", "compaction", "长对话", "超大结果"],
  "幻觉与事实落地": ["幻觉", "hallucination", "信息来源", "引用"],
  "Prompt注入与数据指令隔离": ["prompt注入", "提示词注入"],
  "RAG端到端流程": ["rag检索增强生成", "rag完整", "什么是rag", "rag的完整工作流程"],
  "文档清洗与Chunk切分": ["文档切割", "文档切分", "textsplitter", "chunk_size", "chunk size", "documentloader"],
  "Embedding向量表示": ["embedding", "词嵌入", "文本相似度"],
  "向量索引与Vector DB": ["向量数据库", "向量索引", "hnsw", "ivf", "milvus", "pinecone", "chroma"],
  "混合检索与RRF融合": ["混合检索", "关键词检索", "rrf"],
  "查询改写、扩展与HyDE": ["查询重写", "query rewriting", "hyde"],
  "Reranker重排序": ["reranking", "reranker", "重排序", "重排"],
  "RAG评测、Badcase与知识更新": ["rag评测", "检索不到", "增量更新", "相似度阈值", "top-k"],
  "Agent与Workflow": ["agent和workflow", "agent与workflow", "chain和agent", "agent和chain"],
  "ReAct与Agent循环": ["react", "agent loop", "智能体循环", "agent执行流程", "终止条件", "死循环"],
  "Plan-and-Execute": ["plan-and-execute", "任务分解"],
  "LangChain与LangGraph": ["langgraph", "lcel", "chain是什么", "callback", "动态路由"],
  "状态机与Checkpoint": ["checkpoint", "状态机"],
  "人工介入与Replan": ["human-in-the-loop", "replan", "人工介入"],
  "Function Calling与工具Schema": ["tool calling", "工具调用", "function calling", "函数调用", "tool schema"],
  "工具选择与动态检索": ["工具选择", "工具路由", "动态api调用"],
  "工具校验、重试与幂等": ["工具重试", "工具幂等", "工具调用失败"],
  "MCP架构与生命周期": ["mcp协议", "mcp工作流程", "mcp服务", "mcp server", "mcp client"],
  "MCP与Function Calling": ["mcp和function calling", "mcp与function calling"],
  "Skills与渐进式披露": ["agent skills", "ai agent中的skills", "skills体系", "mcp和skills"],
  "短期记忆与长期记忆": ["短期记忆", "长期记忆", "memory组件", "memory类型"],
  "记忆写入、检索与遗忘": ["记忆写入", "记忆检索", "记忆遗忘"],
  "多Agent协作与编排": ["多agent", "multi-agent", "subagent", "子agent", "agent card", "a2a协议", "a2a"],
  "Agent评测体系": ["agent评测", "评估ai agent", "评估agent"],
  "可观测性与Tracing": ["agent tracing", "llm tracing"],
  "权限、安全与数据治理": ["agent安全", "工具权限", "内容审核", "guardrails", "护栏", "红队测试", "red teaming"],
  "成本、延迟与模型路由": ["模型路由", "token缓存", "成本和延迟", "性能和成本"],
  "循环、超时与故障恢复": ["自动修复循环", "auto-fix loop", "故障恢复"],
  "Agent项目架构讲解": ["agent框架", "agent系统架构", "生产级agent", "agent核心组件"],
  "RAG项目指标与优化复盘": ["rag优化", "rag性能", "rag成本"],
  "生产部署、并发与SSE": ["agent生产环境", "llm生产环境", "sse"],
  "LLM与Agent的区别": ["llm与agent", "llm和agent", "agent和大模型api", "agent与传统ai", "什么是ai agent", "什么是大模型agent"],
  "RAG与Fine-tuning选型": ["rag和fine-tuning", "rag与fine-tuning", "rag和模型微调", "rag与模型微调"],
  "模型微调与对齐": ["lora", "qlora", "dora", "sft", "rlhf", "dpo", "orpo", "ppo", "微调", "灾难性遗忘", "adapter tuning", "prefix tuning"],
  "Agentic RAG": ["agentic rag"],
  "Agent Harness": ["agent harness", "agentic engineering", "background agent", "vibe coding"],
  "CoT思维链": ["cot", "思维链", "tree of thoughts", "思维树", "自洽性", "一步步思考"],
  "Agent会话并发设计": ["会话隔离", "会话并发", "上下文管理和持久化"],
  "LangChain与LlamaIndex选型": ["langchain和llamaindex", "langchain与llamaindex"],
  "RAG知识库热更新": ["知识库热更新", "向量数据库增量更新"],
  "多Agent并发控制": ["多agent并发"],
  "RAG系统架构": ["rag系统架构", "langchain中实现rag"],
  "Agent系统设计": ["agent系统设计", "从零设计agent"]
});

// Current public-bank wording and synonyms.
Object.assign(MANUAL_ALIASES, {
  "Agent Harness": [...MANUAL_ALIASES["Agent Harness"], "computer use"],
  "Agent系统设计": [...MANUAL_ALIASES["Agent系统设计"], "agent核心组件", "agent基本架构", "agent常见功能", "agent智能体的工作过程", "agent框架"],
  "Transformer与自注意力": [...MANUAL_ALIASES["Transformer与自注意力"], "bert", "llama", "自回归", "参数量", "涌现能力", "训练和推理", "模型蒸馏", "模型量化", "多模态"],
  "LangChain与LangGraph": [...MANUAL_ALIASES["LangChain与LangGraph"], "什么是langchain", "langchain核心", "langchain agent", "langchain model", "langchain中的agent", "langchain应用"],
  "权限、安全与数据治理": [...MANUAL_ALIASES["权限、安全与数据治理"], "护栏技术", "安全可控的ai系统"],
  "成本、延迟与模型路由": [...MANUAL_ALIASES["成本、延迟与模型路由"], "gptcache", "本地部署大模型", "云端大模型", "模型蒸馏", "模型量化", "性能和稳定性"],
  "Agent评测体系": [...MANUAL_ALIASES["Agent评测体系"], "ai应用的测试", "效果评估", "llm-as-judge", "benchmark", "a/b测试", "ab测试", "评估大模型"],
  "Function Calling与工具Schema": [...MANUAL_ALIASES["Function Calling与工具Schema"], "自定义tool", "程序和ai大模型的集成", "spring ai"],
  "CoT思维链": [...MANUAL_ALIASES["CoT思维链"], "deep thinking", "adaptive thinking", "自我反思", "few-shot", "zero-shot", "one-shot"],
  "消息角色与Prompt模板": [...MANUAL_ALIASES["消息角色与Prompt模板"], "prompt engineering", "提示词工程", "提示词优化", "提示词中的分隔符", "提示词链接", "负面提示词", "设置约束条件", "专用提示词", "few-shot"],
  "模型微调与对齐": [...MANUAL_ALIASES["模型微调与对齐"], "大模型微调", "全量微调", "参数高效微调", "peft", "冻结层", "混合精度训练", "过拟合", "指令微调"],
  "上下文工程": [...MANUAL_ALIASES["上下文工程"], "过长的提示词", "输入长度的限制"],
  "Embedding向量表示": [...MANUAL_ALIASES["Embedding向量表示"], "比较文本的相似度"],
  "工具选择与动态检索": [...MANUAL_ALIASES["工具选择与动态检索"], "retriever检索器"],
  "循环、超时与故障恢复": [...MANUAL_ALIASES["循环、超时与故障恢复"], "错误和异常"]
});

// Cross-bank questions whose wording omits the canonical noun.
Object.assign(MANUAL_ALIASES, {
  "Agent系统设计": [...MANUAL_ALIASES["Agent系统设计"], "agent的核心组件", "agent的基本架构", "llmagent的基本架构"],
  "MCP架构与生命周期": [...MANUAL_ALIASES["MCP架构与生命周期"], "mcp的工作流程", "mcp架构", "mcp的架构"],
  "B+树索引": [...MANUAL_ALIASES["B+树索引"], "索引类型"],
  "事务ACID": [...MANUAL_ALIASES["事务ACID"], "mysql是如何实现事务"],
  "InnoDB锁与死锁": [...MANUAL_ALIASES["InnoDB锁与死锁"], "mysql中有哪些锁", "mysql中如果发生死锁"],
  "Redis高性能与事件循环": [...MANUAL_ALIASES["Redis高性能与事件循环"], "redis设计为单线程"],
  "Spring Boot启动流程": [...MANUAL_ALIASES["Spring Boot启动流程"], "springboot的核心特性"],
  "Redis数据类型与底层编码": [...MANUAL_ALIASES["Redis数据类型与底层编码"], "redis客户端", "redis通常应用"],
  "Redis跳表与概率数据结构": [...MANUAL_ALIASES["Redis跳表与概率数据结构"], "redis中跳表"],
  "JIT编译、逃逸分析与分层优化": ["编译执行与解释执行", "jit编译"],
  "G1与ZGC": [...MANUAL_ALIASES["G1与ZGC"], "java的垃圾回收进行调优"],
  "JVM运行时内存区域": [...MANUAL_ALIASES["JVM运行时内存区域"], "jvm配置参数", "jvm的内存区域"],
  "TCP可靠传输与拥塞控制": [...MANUAL_ALIASES["TCP可靠传输与拥塞控制"], "tcp是用来解决"],
  "TCP与UDP及粘包拆包": ["粘包和拆包", "tcp和udp", "tcp与udp"],
  "索引失效与优化器选择": [...MANUAL_ALIASES["索引失效与优化器选择"], "建索引时需要注意"],
  "RAG端到端流程": [...MANUAL_ALIASES["RAG端到端流程"], "rag的完整流程", "advanced rag", "modular rag"],
  "文档清洗与Chunk切分": [...MANUAL_ALIASES["文档清洗与Chunk切分"], "数据清洗和预处理", "分块策略", "文档解析", "pdf文档", "pdf、word、markdown"],
  "查询改写、扩展与HyDE": [...MANUAL_ALIASES["查询改写、扩展与HyDE"], "查询扩展", "自查询", "query意图不匹配", "元数据过滤"],
  "上下文工程": [...MANUAL_ALIASES["上下文工程"], "提示压缩"],
  "消息角色与Prompt模板": [...MANUAL_ALIASES["消息角色与Prompt模板"], "提示工程的设计", "评估和优化提示词"],
  "结构化输出与Schema": [...MANUAL_ALIASES["结构化输出与Schema"], "structured outputs"],
  "LangChain与LangGraph": [...MANUAL_ALIASES["LangChain与LangGraph"], "langchain的核心组件", "langchain构建", "langchain有哪", "langchain如何与", "langchain的未来"],
  "LLM与Agent的区别": [...MANUAL_ALIASES["LLM与Agent的区别"], "copilot模式和agent模式"],
  "Agent项目架构讲解": [...MANUAL_ALIASES["Agent项目架构讲解"], "智能工单分类系统", "电商系统", "结合工程化手段"],
  "流式响应、限流与重试": [...MANUAL_ALIASES["流式响应、限流与重试"], "api响应延迟"],
  "混合检索与RRF融合": [...MANUAL_ALIASES["混合检索与RRF融合"], "多路召回", "动态权重分配"],
  "RAG评测、Badcase与知识更新": [...MANUAL_ALIASES["RAG评测、Badcase与知识更新"], "优化rag的检索", "优化检索精度", "评估langchainrag", "评估rag系统", "检索和生成分别"],
  "多Agent协作与编排": [...MANUAL_ALIASES["多Agent协作与编排"], "acp协议"],
  "成本、延迟与模型路由": [...MANUAL_ALIASES["成本、延迟与模型路由"], "开源大模型和闭源大模型"],
  "Transformer与自注意力": [...MANUAL_ALIASES["Transformer与自注意力"], "k和q", "head能否", "k和q变成同一个矩阵"]
});

// Precision corrections found by the unmapped/cross-track audit.
Object.assign(MANUAL_ALIASES, {
  "Redis分布式锁": [...MANUAL_ALIASES["Redis分布式锁"], "redis中如何实现分布式锁", "redis实现分布式锁"],
  "RDB、AOF与混合持久化": [...MANUAL_ALIASES["RDB、AOF与混合持久化"], "redis的持久化"],
  "Spring IoC与依赖注入": [...MANUAL_ALIASES["Spring IoC与依赖注入"], "spring重要的模块", "spring由哪些重要的模块"],
  "权限、安全与数据治理": [...MANUAL_ALIASES["权限、安全与数据治理"], "agent系统的安全性"],
  "短期记忆与长期记忆": [...MANUAL_ALIASES["短期记忆与长期记忆"], "对话记忆持久化", "对话历史的管理和持久化"],
  "生产部署、并发与SSE": [...MANUAL_ALIASES["生产部署、并发与SSE"], "生产环境中使用langchain", "rag系统在生产环境"],
  "RAG评测、Badcase与知识更新": [...MANUAL_ALIASES["RAG评测、Badcase与知识更新"], "rag检索中的top-k"]
});

const OUT_OF_SCOPE_RULES = [
  { reason: "经典 NLP / 传统机器学习扩展题", pattern: /\b(?:lstm|gru|word2vec|cbow|skip-?gram|elmo|glove|fasttext|svm|support vector)\b|支持向量机|文本分类|负采样|hierarchical softmax/i },
  { reason: "特定产品内部实现题", pattern: /openclaw|openmanus|manus|google adk|autogpt|vilt|vit\b|chatglm/i },
  { reason: "标题缺少必要上下文", pattern: /^你觉得可以怎样缓解这个性能瓶颈/ }
];

function safeGeneratedTerms(concept) {
  const values = [concept.name, ...(Array.isArray(concept.tags) ? concept.tags : [])];
  return [...new Set(values.map(normalizeSignalText))]
    .filter((term) => term.length >= 3 && !GENERIC_TERMS.has(term));
}

function aliasesForConcept(concept) {
  return [...new Set([
    ...safeGeneratedTerms(concept),
    ...(MANUAL_ALIASES[concept.name] || []).map(normalizeSignalText)
  ].filter(Boolean))];
}

export function classifyPublicTitleScope(title) {
  const value = String(title || "");
  const exclusion = OUT_OF_SCOPE_RULES.find((rule) => rule.pattern.test(value));
  return exclusion ? { inScope: false, reason: exclusion.reason } : { inScope: true, reason: "" };
}

export function mapPublicTitle(title, concepts) {
  const normalized = normalizeSignalText(title);
  if (!normalized) return [];
  const rawLower = String(title || "").normalize("NFKC").toLowerCase();
  const matches = [];
  for (const concept of concepts) {
    const terms = aliasesForConcept(concept);
    const matched = terms.filter((term) => {
      if (!/^[a-z0-9]+$/i.test(term) || term.length > 4) return normalized.includes(term);
      return new RegExp("(^|[^a-z0-9])" + term + "([^a-z0-9]|$)", "i").test(rawLower);
    });
    if (!matched.length) continue;
    matches.push({
      concept: concept.name,
      track: concept.track,
      score: Math.max(...matched.map((term) => term.length)),
      terms: matched
    });
  }
  const maxScore = Math.max(0, ...matches.map((match) => match.score));
  return matches
    .filter((match) => match.score >= Math.max(2, maxScore - 4))
    .sort((a, b) => b.score - a.score || a.concept.localeCompare(b.concept, "zh-CN"))
    .slice(0, 4);
}

function heatStrength(bank, maxHeat) {
  const heat = Math.max(0, Number(bank.heat || 0));
  const heatPart = Math.log1p(heat) / Math.log1p(Math.max(1, maxHeat));
  const rank = Math.max(1, Number(bank.rank || 50));
  const rankPart = Math.max(0, 1 - Math.log(rank) / Math.log(51));
  return Math.min(1, heatPart * 0.78 + rankPart * 0.22);
}

function positionStrength(position, total) {
  if (total <= 1) return 1;
  const percentile = Math.max(0, Math.min(1, (Number(position || total) - 1) / (total - 1)));
  return 0.55 + 0.45 * (1 - percentile);
}

export function buildPublicQuestionAttention(payload, concepts) {
  const conceptNames = new Set(concepts.map((concept) => concept.name));
  const bankById = new Map((payload?.banks || []).map((bank) => [bank.bankId, bank]));
  const totalsByBank = new Map();
  for (const question of payload?.questions || []) {
    totalsByBank.set(question.bankId, Math.max(totalsByBank.get(question.bankId) || 0, Number(question.position || 0)));
  }
  const maxHeat = Math.max(1, ...(payload?.banks || []).map((bank) => Number(bank.heat || 0)));
  const byConcept = new Map();
  const titleAudit = [];
  const seenTitles = new Set();

  for (const question of payload?.questions || []) {
    const bank = bankById.get(question.bankId);
    if (!bank || !bank.titleSnapshotIncluded) continue;
    const dedupeKey = question.bankId + ":" + normalizeSignalText(question.title);
    if (seenTitles.has(dedupeKey)) continue;
    seenTitles.add(dedupeKey);
    const scope = classifyPublicTitleScope(question.title);
    const matches = mapPublicTitle(question.title, concepts).filter((match) => conceptNames.has(match.concept));
    titleAudit.push({
      bankId: question.bankId,
      questionId: question.questionId,
      position: question.position,
      title: question.title,
      url: question.url,
      ...scope,
      concepts: matches.map((match) => match.concept)
    });
    for (const match of matches) {
      const entry = byConcept.get(match.concept) || { titleKeys: new Set(), banks: new Map(), titles: [] };
      const titleKey = question.bankId + ":" + (question.questionId || normalizeSignalText(question.title));
      entry.titleKeys.add(titleKey);
      const existingBank = entry.banks.get(question.bankId);
      if (!existingBank || Number(question.position) < existingBank.bestPosition) {
        entry.banks.set(question.bankId, {
          bankId: question.bankId,
          title: bank.title,
          url: bank.url,
          rank: bank.rank,
          heat: bank.heat,
          bestPosition: Number(question.position || totalsByBank.get(question.bankId) || 1),
          questionCount: totalsByBank.get(question.bankId) || 1
        });
      }
      if (entry.titles.length < 8) entry.titles.push({ title: question.title, url: question.url, bankId: question.bankId, position: question.position });
      byConcept.set(match.concept, entry);
    }
  }

  const attention = new Map();
  for (const concept of concepts) {
    const entry = byConcept.get(concept.name);
    if (!entry) {
      attention.set(concept.name, {
        available: false,
        attentionBoost: 0,
        publicTitleSamples: 0,
        bankCount: 0,
        signal: "none",
        confidence: "none",
        capturedAt: payload?.capturedAt || null,
        access: "title-only",
        banks: [],
        titles: []
      });
      continue;
    }
    const banks = [...entry.banks.values()].sort((a, b) => a.rank - b.rank || a.bestPosition - b.bestPosition);
    const support = banks.reduce((sum, bank) => sum + heatStrength(bank, maxHeat) * positionStrength(bank.bestPosition, bank.questionCount), 0);
    const attentionBoost = Math.min(2, Math.round(2 * (1 - Math.exp(-support))));
    attention.set(concept.name, {
      available: true,
      attentionBoost,
      publicTitleSamples: entry.titleKeys.size,
      bankCount: banks.length,
      bestBankRank: Math.min(...banks.map((bank) => bank.rank)),
      signal: "snapshot-only",
      confidence: "low",
      capturedAt: payload?.capturedAt || null,
      access: "title-only",
      banks,
      titles: entry.titles
    });
  }

  const inScope = titleAudit.filter((item) => item.inScope);
  const matchedInScope = inScope.filter((item) => item.concepts.length);
  return {
    attention,
    audit: {
      totalTitles: titleAudit.length,
      inScopeTitles: inScope.length,
      matchedInScopeTitles: matchedInScope.length,
      inScopeCoverage: inScope.length ? Number((matchedInScope.length / inScope.length).toFixed(4)) : 1,
      excludedTitles: titleAudit.length - inScope.length,
      unmapped: inScope.filter((item) => !item.concepts.length),
      excluded: titleAudit.filter((item) => !item.inScope),
      mappedConcepts: [...attention.values()].filter((item) => item.available).length
    }
  };
}

export async function loadPublicQuestionSignals() {
  try {
    const payload = JSON.parse(await readFile(join(root, "research", "public-question-signals.json"), "utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : { schemaVersion: 1, banks: [], questions: [] };
  } catch {
    return { schemaVersion: 1, banks: [], questions: [] };
  }
}
