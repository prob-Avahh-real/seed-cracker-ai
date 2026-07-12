/**
 * 舵机控制抽象层
 *
 * 封装开壳舵机和推料舵机的动作序列，
 * 提供高层 API 供 AI 编排器调用。
 */

import { SerialController } from './serial';
import { getConfig } from '../config';
import logger from '../utils/logger';

export interface ServoState {
  crackAngle: number;
  feedAngle: number;
  isHomed: boolean;
}

export class ServoController {
  private state: ServoState = {
    crackAngle: 0,
    feedAngle: 0,
    isHomed: true,
  };

  constructor(private serial: SerialController) {}

  /**
   * 归位 — 所有舵机回到初始位置
   */
  async home(): Promise<void> {
    logger.debug('Servo: homing all servos');
    await this.serial.home();
    this.state = { crackAngle: 0, feedAngle: 0, isHomed: true };
  }

  /**
   * 推入一颗瓜子到开壳工位
   */
  async feedSeed(): Promise<void> {
    logger.debug('Servo: feeding seed');
    const cfg = getConfig();

    // 先归位确保推料机构在正确位置
    await this.serial.home();

    // 执行推料
    await this.serial.feed();

    // 等待机械动作完成
    await this.delay(cfg.hardware.servoDelay);
    this.state.isHomed = false;
  }

  /**
   * 执行开壳动作
   * @param pressureFeedback - 可选的压力反馈回调，用于自适应力度
   */
  async crackSeed(pressureFeedback?: (pressure: number) => number): Promise<boolean> {
    const cfg = getConfig();
    let angle = cfg.hardware.crackServoAngle;

    // 自适应压力控制
    if (pressureFeedback) {
      const currentPressure = await this.serial.readPressure();
      angle = pressureFeedback(currentPressure);
    }

    logger.debug(`Servo: cracking at angle ${angle}°`);
    await this.serial.crack(angle);
    this.state.crackAngle = angle;

    // 开壳后读取压力判断是否成功
    await this.delay(cfg.hardware.servoDelay);
    const postPressure = await this.serial.readPressure();
    const success = postPressure < cfg.hardware.pressureThreshold;

    logger.debug(`Servo: crack result - pressure ${postPressure}, success: ${success}`);
    return success;
  }

  /**
   * 排出残壳
   */
  async ejectShell(): Promise<void> {
    logger.debug('Servo: ejecting shell');
    await this.serial.eject();
    await this.delay(getConfig().hardware.servoDelay);
  }

  /**
   * 获取当前舵机状态
   */
  getState(): ServoState {
    return { ...this.state };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
