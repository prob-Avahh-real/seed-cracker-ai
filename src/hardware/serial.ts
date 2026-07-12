/**
 * 串口通信协议 — 与 Arduino 固件交互
 *
 * 协议格式 (文本行):
 *   → 命令:  "CMD [arg1] [arg2]\\n"
 *   ← 响应:  "OK [data]\\n"  或  "ERR [message]\\n"
 *
 * 支持命令:
 *   FEED       - 推料 (送入一颗瓜子)
 *   CRACK [deg]- 开壳 (指定舵机角度)
 *   EJECT      - 排出残壳
 *   HOME       - 舵机归位
 *   PRESSURE   - 读取压力传感器
 *   STATUS     - 获取设备状态
 *   PING       - 心跳检测
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from 'serialport';
import { EventEmitter } from 'events';

export interface HardwareStatus {
  connected: boolean;
  servoPosition: number;
  pressure: number;
  seedsRemaining: number;
  errors: string[];
}

export declare interface SerialController {
  on(event: 'status', listener: (status: HardwareStatus) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'disconnect', listener: () => void): this;
}

export class SerialController extends EventEmitter {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private commandQueue: Array<{
    command: string;
    resolve: (value: string) => void;
    reject: (reason: Error) => void;
  }> = [];
  private isProcessing = false;
  private status: HardwareStatus = {
    connected: false,
    servoPosition: 0,
    pressure: 0,
    seedsRemaining: 0,
    errors: [],
  };

  /**
   * 连接到串口设备并启动心跳
   */
  async connect(path: string, baudRate: number = 115200): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.port = new SerialPort({
          path,
          baudRate,
          autoOpen: false,
        });

        this.port.open((err) => {
          if (err) return reject(err);

          this.parser = this.port!.pipe(new ReadlineParser({ delimiter: '\n' }));
          this.parser.on('data', (line: string) => this.handleResponse(line.trim()));

          this.port!.on('close', () => {
            this.status.connected = false;
            this.emit('disconnect');
          });

          this.port!.on('error', (err) => {
            this.status.errors.push(err.message);
            this.emit('error', err);
          });

          this.status.connected = true;
          this.emit('status', this.status);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 断开串口连接
   */
  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.port && this.port.isOpen) {
        this.port.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * 发送命令并等待响应
   */
  private sendCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.isProcessing || this.commandQueue.length === 0) return;
    if (!this.port || !this.port.isOpen) {
      const err = new Error('Serial port not connected');
      this.commandQueue.forEach((q) => q.reject(err));
      this.commandQueue = [];
      return;
    }

    this.isProcessing = true;
    const { command, reject } = this.commandQueue[0];

    this.port.write(command + '\n', (err) => {
      if (err) {
        this.isProcessing = false;
        reject(err);
        this.commandQueue.shift();
        this.processQueue();
      }
    });

    // 超时保护
    setTimeout(() => {
      if (this.isProcessing && this.commandQueue.length > 0) {
        this.isProcessing = false;
        const timedOut = this.commandQueue.shift()!;
        timedOut.reject(new Error(`Command timeout: ${timedOut.command}`));
        this.processQueue();
      }
    }, 3000);
  }

  private handleResponse(line: string): void {
    if (line.startsWith('OK') || line.startsWith('ERR')) {
      this.isProcessing = false;
      const item = this.commandQueue.shift();
      if (!item) return;

      if (line.startsWith('ERR')) {
        item.reject(new Error(line.substring(4)));
      } else {
        item.resolve(line.substring(3));
      }
      this.processQueue();
      return;
    }

    // 处理主动上报数据
    if (line.startsWith('STATUS ')) {
      try {
        const data = JSON.parse(line.substring(7));
        this.status = { ...this.status, ...data };
        this.emit('status', this.status);
      } catch { /* ignore parse errors */ }
    }
  }

  // ──── 硬件命令 ────

  /** 推入一颗瓜子到开壳工位 */
  async feed(): Promise<void> {
    await this.sendCommand('FEED');
  }

  /** 执行开壳动作 (舵机角度) */
  async crack(angle?: number): Promise<void> {
    const deg = angle ?? 45;
    await this.sendCommand(`CRACK ${deg}`);
  }

  /** 排出残壳 */
  async eject(): Promise<void> {
    await this.sendCommand('EJECT');
  }

  /** 舵机归位 */
  async home(): Promise<void> {
    await this.sendCommand('HOME');
  }

  /** 读取压力传感器值 (0-1023) */
  async readPressure(): Promise<number> {
    const resp = await this.sendCommand('PRESSURE');
    return parseInt(resp, 10);
  }

  /** 心跳检测 */
  async ping(): Promise<boolean> {
    try {
      await this.sendCommand('PING');
      return true;
    } catch {
      return false;
    }
  }

  /** 获取当前硬件状态 */
  getStatus(): HardwareStatus {
    return { ...this.status };
  }

  /** 自动扫描并连接第一个可用串口 */
  static async autoConnect(baudRate: number = 115200): Promise<SerialController> {
    const ports = await SerialPort.list();
    if (ports.length === 0) {
      throw new Error('No serial ports found');
    }

    const controller = new SerialController();

    // 依次尝试每个端口
    for (const portInfo of ports) {
      try {
        await controller.connect(portInfo.path, baudRate);
        const alive = await controller.ping();
        if (alive) return controller;
        await controller.disconnect();
      } catch {
        // 继续尝试下一个
      }
    }

    throw new Error('No compatible device found on any serial port');
  }
}
