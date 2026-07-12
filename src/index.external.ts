/**
 * 嗑瓜子神器 AI 驱动程序 - 公共 API 导出
 */

export { AICrackerOrchestrator } from './ai/orchestrator';
export type { SeedProcessResult, SessionStats } from './ai/orchestrator';

export { StateMachine, CrackerState, STATE_TRANSITIONS } from './ai/state-machine';
export type { StateMachineEvent } from './ai/state-machine';

export { QualityAssessor } from './ai/quality';
export type { CrackQuality } from './ai/quality';

export { CameraCapture } from './vision/camera';
export type { CaptureResult } from './vision/camera';

export { SeedDetector } from './vision/detector';
export type { BoundingBox, DetectedSeed } from './vision/detector';

export { OrientationClassifier } from './vision/classifier';
export type { SeedOrientation, OrientationResult, SeedQuality } from './vision/classifier';

export { SerialController } from './hardware/serial';
export type { HardwareStatus } from './hardware/serial';

export { ServoController } from './hardware/servo';
export type { ServoState } from './hardware/servo';

export { CrackerServer } from './server/http';

export { loadConfig, getConfig, updateConfig } from './config';
export type { AppConfig } from './config';
