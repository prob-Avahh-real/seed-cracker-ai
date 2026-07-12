/**
 * 嗑瓜子神器 Arduino 固件 (seed_cracker.ino)
 *
 * 硬件连接:
 *   - 开壳舵机: D9  (SG90/MG996R, PWM)
 *   - 推料舵机: D10 (SG90, PWM)
 *   - 压力传感器: A0 (FSR402 薄膜压力传感器)
 *   - 振动电机: D5  (用于辅助排壳)
 *   - LED 指示灯: D13 (板载 LED)
 *
 * 通信协议: 文本行, 115200 bps
 */

/*
#include <Servo.h>

// ──── 引脚定义 ────
const int PIN_CRACK_SERVO  = 9;
const int PIN_FEED_SERVO   = 10;
const int PIN_PRESSURE     = A0;
const int PIN_VIBRATE      = 5;
const int PIN_LED           = 13;

// ──── 舵机对象 ────
Servo crackServo;
Servo feedServo;

// ──── 状态变量 ────
int crackAngle  = 0;    // 当前开壳舵机角度
int feedAngle   = 0;    // 当前推料舵机角度
int pressure    = 0;    // 当前压力读数
int seedCount   = 0;    // 已处理瓜子计数
unsigned long lastStatus = 0;

// ──── 初始化 ────
void setup() {
  Serial.begin(115200);

  crackServo.attach(PIN_CRACK_SERVO);
  feedServo.attach(PIN_FEED_SERVO);
  pinMode(PIN_VIBRATE, OUTPUT);
  pinMode(PIN_LED, OUTPUT);

  // 舵机归位
  crackServo.write(0);
  feedServo.write(0);

  digitalWrite(PIN_LED, HIGH);
  delay(500);
  digitalWrite(PIN_LED, LOW);

  Serial.println("OK READY");
}

// ──── 主循环 ────
void loop() {
  // 处理串口命令
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    processCommand(cmd);
  }

  // 每500ms 上报一次状态
  if (millis() - lastStatus > 500) {
    reportStatus();
    lastStatus = millis();
  }
}

// ──── 命令处理 ────
void processCommand(String cmd) {
  if (cmd == "PING") {
    Serial.println("OK PONG");
  }
  else if (cmd == "FEED") {
    doFeed();
    Serial.println("OK FED");
  }
  else if (cmd.startsWith("CRACK")) {
    int angle = 45;  // 默认角度
    int spaceIdx = cmd.indexOf(' ');
    if (spaceIdx > 0) {
      angle = cmd.substring(spaceIdx + 1).toInt();
      angle = constrain(angle, 0, 180);
    }
    doCrack(angle);
    Serial.print("OK CRACKED ");
    Serial.println(angle);
  }
  else if (cmd == "EJECT") {
    doEject();
    Serial.println("OK EJECTED");
  }
  else if (cmd == "HOME") {
    doHome();
    Serial.println("OK HOMED");
  }
  else if (cmd == "PRESSURE") {
    int val = analogRead(PIN_PRESSURE);
    Serial.print("OK ");
    Serial.println(val);
  }
  else if (cmd == "STATUS") {
    reportStatus();
  }
  else {
    Serial.print("ERR Unknown command: ");
    Serial.println(cmd);
  }
}

// ──── 机械动作 ────
void doFeed() {
  // 推料: 0°→90°→0° (推入一颗瓜子)
  feedServo.write(90);
  delay(400);
  feedServo.write(0);
  delay(200);
  seedCount++;
}

void doCrack(int angle) {
  // 开壳: 0°→angle°→0°
  crackServo.write(angle);
  delay(300);

  // 读取压力判断是否成功
  pressure = analogRead(PIN_PRESSURE);

  // 短暂振动辅助壳仁分离
  digitalWrite(PIN_VIBRATE, HIGH);
  delay(100);
  digitalWrite(PIN_VIBRATE, LOW);

  crackServo.write(0);
  delay(200);
}

void doEject() {
  // 排壳: 振动 + 倾斜
  digitalWrite(PIN_VIBRATE, HIGH);
  delay(300);
  digitalWrite(PIN_VIBRATE, LOW);
}

void doHome() {
  crackServo.write(0);
  feedServo.write(0);
  digitalWrite(PIN_VIBRATE, LOW);
  crackAngle = 0;
  feedAngle = 0;
}

// ──── 状态上报 ────
void reportStatus() {
  pressure = analogRead(PIN_PRESSURE);

  Serial.print("STATUS {\"pressure\":");
  Serial.print(pressure);
  Serial.print(",\"crackAngle\":");
  Serial.print(crackAngle);
  Serial.print(",\"feedAngle\":");
  Serial.print(feedAngle);
  Serial.print(",\"seedCount\":");
  Serial.print(seedCount);
  Serial.println("}");
}
*/
