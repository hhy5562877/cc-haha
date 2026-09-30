export type {
  AppStateResult,
  AppStateScreenshot,
  AppTarget,
  CodexComputerEngine,
  CodexMouseButton,
  ComputerExecutor,
  DisplayGeometry,
  FrontmostApp,
  InstalledApp,
  ProcessIdentity,
  ResolvedAppTarget,
  ResolvePrepareCaptureResult,
  RunningApp,
  ScreenshotResult,
  SetValueResult,
} from "../../server/vendor/computer-use-mcp/executor.js";

export type {
  AppGrant,
  CuAppPermTier,
  ComputerUseHostAdapter,
  ComputerUseOverrides,
  ComputerUseSessionContext,
  CoordinateMode,
  CuGrantFlags,
  CuPermissionRequest,
  CuPermissionResponse,
  CuSubGates,
  CuTeachPermissionRequest,
  Logger,
  ResolvedAppRequest,
  ScreenshotDims,
  TeachStepRequest,
  TeachStepResult,
} from "../../server/vendor/computer-use-mcp/types.js";

export { DEFAULT_GRANT_FLAGS } from "../../server/vendor/computer-use-mcp/types.js";

export {
  SENTINEL_BUNDLE_IDS,
  getSentinelCategory,
} from "./sentinelApps.js";
export type { SentinelCategory } from "./sentinelApps.js";

export {
  categoryToTier,
  getDefaultTierForApp,
  getDeniedCategory,
  getDeniedCategoryByDisplayName,
  getDeniedCategoryForApp,
  isPolicyDenied,
} from "../../server/vendor/computer-use-mcp/deniedApps.js";
export type { DeniedCategory } from "../../server/vendor/computer-use-mcp/deniedApps.js";

export { isSystemKeyCombo, normalizeKeySequence } from "../../server/vendor/computer-use-mcp/keyBlocklist.js";

export { ALL_SUB_GATES_OFF, ALL_SUB_GATES_ON } from "./subGates.js";

export { API_RESIZE_PARAMS, targetImageSize } from "./imageResize.js";
export type { ResizeParams } from "./imageResize.js";

export { defersLockAcquire, handleToolCall } from "../../server/vendor/computer-use-mcp/toolCalls.js";
export type {
  CuCallTelemetry,
  CuCallToolResult,
  CuErrorKind,
} from "../../server/vendor/computer-use-mcp/toolCalls.js";

export {
  bindSessionContext,
  buildPlatformComputerUseTools,
  createComputerUseMcpServer,
} from "./mcpServer.js";
export { buildComputerUseTools } from "../../server/vendor/computer-use-mcp/tools.js";

export {
  comparePixelAtLocation,
  validateClickTarget,
} from "./pixelCompare.js";
export type { CropRawPatchFn, PixelCompareResult } from "./pixelCompare.js";
