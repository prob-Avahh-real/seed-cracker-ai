/**
 * AI 编排器 — 嗑瓜子神器的核心大脑
 *
 * 协调视觉、硬件、状态机各模块，
 * 实现完整的 "检测 → 分类 → 开壳 → 验证 → 排出" 流水线。
 * 支持自适应压力控制和连续批量处理。
 */

import { EventEmitter } from 'events';
import { CameraCapture, CaptureResult } from '../vision/camera';
import { SeedDetector, DetectedSeed } from '../vision/detector';
import { OrientationClassifier, OrientationResult, SeedQuality } from '../vision/classifier';
import { SerialController } from '../hardware/serial';
import { ServoController } from '../hardware/servo';
import { StateMachine, CrackerState } from './state-machine';
import { QualityAssessor, CrackQuality } from './quality';
import { getConfig } from '../config';
import logger from '../utils/logger';

export interface SeedProcessResult {
  seedId: number;
  success: boolean;
  orientation: string;
  quality: SeedQuality | null;
  crackQuality: CrackQuality | null;
  retries: number;
  durationMs: number;
  error?: string;
}

export interface SessionStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  rejected: number;
  averageTimeMs: number;
  successRate: number;
  currentState: CrackerState;
}

export declare interface AICrackerOrchestrator {
  on(event: 'seed', listener: (result: SeedProcessResult) => void): this;
  on(event: 'stats', listener: (stats: SessionStats) => void): this;
  on(event: 'state', listener: (state: CrackerState) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export class AICrackerOrchestrator extends EventEmitter {
  private camera: CameraCapture;
  private detector: SeedDetector;
  private classifier: OrientationClassifier;
  private stateMachine: StateMachine;
  private qualityAssessor: QualityAssessor;
  private serial: SerialController | null = null;
  private servo: ServoController | null = null;

  private isRunning = false;
  private shouldStop = false;
  private seedCounter = 0;

  private stats: SessionStats = {
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    rejected: 0,
    averageTimeMs: 0,
    successRate: 0,
    currentState: CrackerState.IDLE,
  };

  private totalTime = 0;

  constructor() {
    super();
    this.camera = new CameraCapture();
    this.detector = new SeedDetector();
    this.classifier = new OrientationClassifier();
    this.stateMachine = new StateMachine();
    this.qualityAssessor = new QualityAssessor();

    // 状态变化监听
    this.stateMachine.on('state_change', (event) => {
      this.stats.currentState = event.to;
      this.emit('state', event.to);
    });

    this.stateMachine.on('error', (event) => {
      logger.error(`State machine error: ${event.data}`);
      this.emit('error', new Error(event.data));
    });
  }

  /**
   * 初始化硬件连接
   */
  async init(serialPath?: string): Promise<void> {
    const cfg = getConfig();

    try {
      if (serialPath) {
        this.serial = new SerialController();
        await this.serial.connect(serialPath, cfg.hardware.baudRate);
      } else {
        this.serial = await SerialController.autoConnect(cfg.hardware.baudRate);
      }

      this.servo = new ServoController(this.serial);
      await this.servo.home();

      logger.info('Hardware initialized successfully');
    } catch (err) {
      logger.warn('Hardware not available, running in simulation mode');
      // 模拟模式下继续运行，方便开发和测试
    }
  }

  /**
   * 处理单颗瓜子 (核心流程)
   */
  async processSeed(): Promise<SeedProcessResult> {
    const startTime = Date.now();
    const seedId = ++this.seedCounter;
    let retries = 0;
    const cfg = getConfig();

    const result: SeedProcessResult = {
      seedId,
      success: false,
      orientation: 'unknown',
      quality: null,
      crackQuality: null,
      retries: 0,
      durationMs: 0,
    };

    try {
      // ──── Stage 1: FEEDING ────
      this.stateMachine.transition(CrackerState.FEEDING);
      logger.info(`[Seed #${seedId}] Feeding seed`);

      if (this.servo) {
        await this.servo.feedSeed();
      }
      await this.delay(cfg.ai.seedInterval);

      // ──── Stage 2: DETECTING ────
      this.stateMachine.transition(CrackerState.DETECTING);

      const frame = await this.camera.capture();
      const seed = await this.detector.detectPrimary(
        frame.pixelData, frame.width, frame.height
      );

      if (!seed) {
        logger.warn(`[Seed #${seedId}] No seed detected`);
        this.stateMachine.transition(CrackerState.EJECTING);
        if (this.servo) await this.servo.ejectShell();
        this.stateMachine.transition(CrackerState.IDLE);
        result.error = 'No seed detected';
        this.recordResult(result, startTime);
        return result;
      }

      // ──── Stage 3: CLASSIFYING ────
      this.stateMachine.transition(CrackerState.CLASSIFYING);

      const orientation = await this.classifier.classifyByShape(
        seed, frame.pixelData, frame.width
      );
      result.orientation = orientation.orientation;

      // 质量检测
      const quality = await this.classifier.assessQuality(
        seed, frame.pixelData, frame.width
      );
      result.quality = quality;

      if (!quality.crackable) {
        logger.warn(`[Seed #${seedId}] Rejected: ${quality.defects.join(', ')}`);
        this.stateMachine.transition(CrackerState.EJECTING);
        if (this.servo) await this.servo.ejectShell();
        this.stateMachine.transition(CrackerState.IDLE);
        this.stats.rejected++;
        result.durationMs = Date.now() - startTime;
        this.emit('seed', result);
        return result;
      }

      // ──── Stage 4: CRACKING ────
      this.stateMachine.transition(CrackerState.CRACKING);

      // 捕获开壳前图像用于比较
      const beforeCrack = await this.camera.capture();

      // 自适应压力控制
      const pressureFeedback = orientation.orientation === 'tip_down'
        ? (p: number) => Math.max(20, cfg.hardware.crackServoAngle - 10) // 尖端朝下需要更小力度
        : undefined;

      let crackSuccess = false;
      if (this.servo) {
        crackSuccess = await this.servo.crackSeed(pressureFeedback);
      } else {
        // 模拟模式
        crackSuccess = Math.random() > 0.3;
      }

      // ──── Stage 5: VERIFYING ────
      this.stateMachine.transition(CrackerState.VERIFYING);

      const afterCrack = await this.camera.capture();
      const crackQuality = await this.qualityAssessor.assess(
        beforeCrack.pixelData,
        afterCrack.pixelData,
        beforeCrack.width,
        beforeCrack.height
      );
      result.crackQuality = crackQuality;

      // 重试逻辑
      while (!crackQuality.success && retries < cfg.ai.maxRetries) {
        retries++;
        logger.info(`[Seed #${seedId}] Retry ${retries}/${cfg.ai.maxRetries}`);

        this.stateMachine.transition(CrackerState.CRACKING);
        if (this.servo) {
          // 重试时增加力度
          const retryAngle = cfg.hardware.crackServoAngle + retries * 10;
          await this.servo.crackSeed(() => retryAngle);
        }

        this.stateMachine.transition(CrackerState.VERIFYING);
        const retryAfter = await this.camera.capture();
        const retryQuality = await this.qualityAssessor.assess(
          afterCrack.pixelData,
          retryAfter.pixelData,
          afterCrack.width,
          afterCrack.height
        );
        result.crackQuality = retryQuality;

        if (retryQuality.success) break;
      }

      result.retries = retries;
      result.success = result.crackQuality?.success ?? false;

      // ──── Stage 6: EJECTING ────
      this.stateMachine.transition(CrackerState.EJECTING);
      if (this.servo) await this.servo.ejectShell();
      this.stateMachine.transition(CrackerState.IDLE);

    } catch (err: any) {
      logger.error(`[Seed #${seedId}] Error: ${err.message}`);
      result.error = err.message;
      this.stateMachine.forceState(CrackerState.ERROR);
      if (this.servo) await this.servo.home().catch(() => {});
      this.stateMachine.forceState(CrackerState.IDLE);
    }

    result.durationMs = Date.now() - startTime;
    this.recordResult(result, startTime);
    return result;
  }

  /**
   * 批量处理瓜子 (连续模式)
   */
  async processBatch(count?: number): Promise<void> {
    this.isRunning = true;
    this.shouldStop = false;
    let processed = 0;

    logger.info(`Starting batch processing${count ? ` (target: ${count})` : ' (continuous)'}`);

    while (this.isRunning && !this.shouldStop) {
      const result = await this.processSeed();
      this.emit('seed', result);

      processed++;
      if (count && processed >= count) break;

      // 检查是否应该停止
      if (this.shouldStop) break;
    }

    logger.info(`Batch complete: ${processed} seeds processed`);
    this.isRunning = false;
  }

  /**
   * 停止处理
   */
  async stop(): Promise<void> {
    this.shouldStop = true;
    this.isRunning = false;

    if (this.servo) {
      await this.servo.home();
    }
    if (this.serial) {
      await this.serial.disconnect();
    }

    this.stateMachine.reset();
    logger.info('Orchestrator stopped');
  }

  /**
   * 暂停/恢复
   */
  pause(): void {
    this.stateMachine.transition(CrackerState.PAUSED);
    this.isRunning = false;
  }

  resume(): void {
    this.stateMachine.transition(CrackerState.IDLE);
    this.isRunning = true;
  }

  /**
   * 获取当前统计信息
   */
  getStats(): SessionStats {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      rejected: 0,
      averageTimeMs: 0,
      successRate: 0,
      currentState: CrackerState.IDLE,
    };
    this.totalTime = 0;
    this.seedCounter = 0;
  }

  private recordResult(result: SeedProcessResult, startTime: number): void {
    this.stats.totalProcessed++;
    if (result.success) {
      this.stats.successful++;
    } else if (result.quality && !result.quality.crackable) {
      // rejected 已在上面处理
    } else {
      this.stats.failed++;
    }

    this.totalTime += result.durationMs;
    this.stats.averageTimeMs = Math.round(this.totalTime / this.stats.totalProcessed);
    this.stats.successRate = this.stats.successful / this.stats.totalProcessed;

    this.emit('stats', this.getStats());
    logger.info(
      `[Seed #${result.seedId}] ${result.success ? '✓' : '✗'} ` +
      `time=${result.durationMs}ms retries=${result.retries} ` +
      `| total=${this.stats.totalProcessed} ok=${this.stats.successful} ` +
      `rate=${(this.stats.successRate * 100).toFixed(1)}%`
    );

    // 定期清理缓存
    if (this.stats.totalProcessed % 20 === 0) {
      this.camera.cleanup();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
