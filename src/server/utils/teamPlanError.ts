/**
 * server 侧团队计划错误类型。
 *
 * 原定义在引擎支撑层 src/utils/swarm/teamPlanStore.ts；解耦批次 2 将 server
 * 唯一消费的该类提取到本地，切断 server → swarm 子系统的直接依赖边
 * （swarm 余下 4800+ 行为引擎多 agent 机制，随引擎休眠）。
 */
export class TeamPlanError extends Error {
  constructor(message: string, public status = 409) { super(message) }
}
