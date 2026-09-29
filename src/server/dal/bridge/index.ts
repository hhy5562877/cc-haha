/**
 * dal-bridge 服务端模块公共出口。
 *
 * - handleDalBridgeRoute：router.ts 挂载的 HTTP 路由入口
 * - buildDalBridgeEnv：proto 适配层在 buildChildEnv 中调用的环境变量契约
 * - setGuardModeForSession / getGuardModeForSession：WS set_permission_mode
 *   到 dal-guard 模式的运行时切换
 * - cleanupDalBridgeSession / clearGuardModeForSession：会话销毁清理
 *
 * 完整契约见 docs/dal-integration/bridge-contract.md。
 */

export { handleDalBridgeRoute } from './endpoints.js'
export {
  buildDalBridgeEnv,
  cleanupDalBridgeSession,
} from './sessionStore.js'
export {
  setGuardModeForSession,
  getGuardModeForSession,
  clearGuardModeForSession,
  toDalGuardMode,
} from './guardMode.js'
export { DAL_BRIDGE_RESPONSE_TIMEOUT_MS, DAL_BRIDGE_REQUEST_PREFIX, type DalGuardMode } from './types.js'
