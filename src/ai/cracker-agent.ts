/**
 * Cracker Agent — 自主决策层
 *
 * 在现有 AICrackerOrchestrator 之上增加:
 * - 自适应速度控制 (根据连续成功率动态调整 seedInterval)
 * - 预测性维护 (统计舵机动作次数, 提示保养)
 * - 异常恢复 (连续失败 → 自动停机 + 自检)
 * - 学习模式 (记录最佳 crackAngle, 持续优化)
 *
 * Agent 不替代 Orchestrator，而是包裹它，提供自主决策。
 */

import { EventEmitter } from 'events';
import {
  AICrackerOrchestrator,
  SeedProcessResult,
  SessionStats,
} from '../ai/orchestrator';
import { CrackerState } from '../ai/state-machine';
import { getConfig, updateConfig } from '../config';
import logger from '../utils/logger';

export interface AgentInsight {
  /** 建议的 seedInterval 调整值 (ms) */
  suggestedInterval: number;
  /** 建议的 crackAngle */
  suggestedAngle: number;
  /** 是否需要保养 */
  maintenanceNeeded: boolean;
  /** 保养原因 */
  maintenanceReason: string;
  /** 当前适应级别 (0=初始, 1=学习, 2=优化, 3=专家) */
  adaptationLevel: number;
}

export declare interface CrackerAgent {
  on(event: 'insight', listener: (insight: AgentInsight) => void): this;
  on(event: 'auto_stop', listener: (reason: string) => void): this;
  on(event: 'maintenance_alert', listener: (reason: string) => void): this;
}

export class CrackerAgent extends EventEmitter {
  private orchestrator: AICrackerOrchestrator;

  // 自适应参数
  private recentResults: boolean[] = [];       // 最近 20 个结果 (true=成功)
  private totalCracks = 0;
  private optimalAngles: number[] = [];        // 成功开壳时的角度记录
  private consecutiveFailures = 0;
  private servoCycles = 0;
  private lastMaintenanceAt = 0;

  // Agent 状态
  private adaptationLevel = 0;
  private autoStopThreshold = 10;              // 连续失败 10 次 → 自动停机

  constructor(orchestrator: AICrackerOrchestrator) {
    super();
    this.orchestrator = orchestrator;

    // 监听每次开壳结果
    this.orchestrator.on('seed', (result: SeedProcessResult) => {
      this.learn(result);
    });

    this.orchestrator.on('stats', (stats: SessionStats) => {
      this.evaluateHealth(stats);
    });
  }

  /**
   * 从每次开壳结果中学习
   */
  private learn(result: SeedProcessResult): void {
    this.totalCracks++;
    this.servoCycles++;

    // 记录最近 20 次结果
    this.recentResults.push(result.success);
    if (this.recentResults.length > 20) this.recentResults.shift();

    if (result.success) {
      this.consecutiveFailures = 0;

      // 记录成功时的 crackAngle
      const cfg = getConfig();
      this.optimalAngles.push(cfg.hardware.crackServoAngle);
      if (this.optimalAngles.length > 50) this.optimalAngles.shift();
    } else {
      this.consecutiveFailures++;
    }

    // 自动停机检测
    if (this.consecutiveFailures >= this.autoStopThreshold) {
      this.emit('auto_stop', `连续 ${this.consecutiveFailures} 次失败，自动停机`);
      this.orchestrator.stop();
    }

    // 自适应调速
    this.adaptSpeed();
    this.adaptAngle();

    // 每 50 次检查是否需要保养
    if (this.servoCycles % 50 === 0) {
      this.checkMaintenance();
    }
  }

  /**
   * 根据成功率自适应调整 seedInterval
   */
  private adaptSpeed(): void {
    if (this.recentResults.length < 5) return;

    const successRate = this.recentResults.filter(Boolean).length / this.recentResults.length;
    const cfg = getConfig();
    let newInterval = cfg.ai.seedInterval;

    if (successRate > 0.9 && this.adaptationLevel < 2) {
      // 高成功率 → 加速
      newInterval = Math.max(100, cfg.ai.seedInterval - 20);
      this.adaptationLevel = 2;
    } else if (successRate < 0.5 && cfg.ai.seedInterval < 500) {
      // 低成功率 → 减速 (给舵机更多恢复时间)
      newInterval = Math.min(500, cfg.ai.seedInterval + 50);
    }

    if (newInterval !== cfg.ai.seedInterval) {
      updateConfig({ ai: { seedInterval: newInterval } } as any);
      logger.info(`Agent: adapted seedInterval to ${newInterval}ms (successRate=${(successRate * 100).toFixed(0)}%)`);
    }
  }

  /**
   * 根据历史最佳角度调整 crackAngle
   */
  private adaptAngle(): void {
    if (this.optimalAngles.length < 10) return;

    const avg = this.optimalAngles.reduce((a, b) => a + b, 0) / this.optimalAngles.length;
    const cfg = getConfig();

    if (Math.abs(avg - cfg.hardware.crackServoAngle) > 5) {
      const newAngle = Math.round(avg);
      updateConfig({ hardware: { crackServoAngle: newAngle } } as any);
      logger.info(`Agent: adapted crackAngle to ${newAngle}° (from ${this.optimalAngles.length} samples)`);
    }
  }

  /**
   * 评估系统健康状态
   */
  private evaluateHealth(stats: SessionStats): void {
    const insight: AgentInsight = {
      suggestedInterval: getConfig().ai.seedInterval,
      suggestedAngle: getConfig().hardware.crackServoAngle,
      maintenanceNeeded: this.servoCycles > 0 && this.servoCycles - this.lastMaintenanceAt > 5000,
      maintenanceReason: '',
      adaptationLevel: this.adaptationLevel,
    };

    if (insight.maintenanceNeeded) {
      insight.maintenanceReason =
        `舵机已执行 ${this.servoCycles} 次动作，建议检查机械磨损并添加润滑`;
      this.emit('maintenance_alert', insight.maintenanceReason);
    }

    if (stats.successRate < 0.4 && stats.totalProcessed > 20) {
      insight.maintenanceReason += ' | 成功率持续偏低，建议检查开壳刀片锋利度';
    }

    this.emit('insight', insight);
  }

  /**
   * 检查是否需要保养
   */
  private checkMaintenance(): void {
    if (this.servoCycles - this.lastMaintenanceAt > 5000) {
      this.emit('maintenance_alert',
        `建议保养: 舵机已运行 ${this.servoCycles} 次 (上次保养: ${this.lastMaintenanceAt})`
      );
    }
  }

  /**
   * 手动标记保养完成
   */
  markMaintenanceDone(): void {
    this.lastMaintenanceAt = this.servoCycles;
    logger.info('Maintenance marked as done at cycle ' + this.servoCycles);
  }

  /**
   * 重置 Agent 学习状态
   */
  reset(): void {
    this.recentResults = [];
    this.optimalAngles = [];
    this.consecutiveFailures = 0;
    this.adaptationLevel = 0;
  }
}
