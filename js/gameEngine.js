/**
 * gameEngine.js
 * 청기백기 게임 로직 전체를 담당
 *
 * 게임 규칙:
 * - 각 단계마다 5번 시행
 * - 2번 실패 시 게임 오버
 * - 1번 이하 실패 시 다음 단계 진입
 * - 단계마다 제한 시간 0.1초씩 감소 (1.5초 → 1.4초 → ...)
 */

class GameEngine {
  constructor() {
    // 게임 상태
    this.isGameActive = false;
    this.isPaused = false;

    // 단계 관리
    this.level = 1; // 현재 단계
    this.maxLevel = 1; // 최고 도달 단계

    // 진행도
    this.currentRound = 0; // 현재 라운드 (0~4, 총 5회)
    this.failCount = 0; // 현재 단계 실패 횟수 (0~2)
    this.totalSuccess = 0; // 총 성공 횟수
    this.isWaitingForPose = false; // 포즈 대기 중 플래그

    // 타이머
    this.baseTimeLimit = 1.0; // 1단계 기본 시간 (초)
    this.timeDecrement = 0.1; // 단계마다 감소 시간
    this.minTimeLimit = 0.2; // 최소 제한 시간
    this.currentTimeLimit = 1.0; // 현재 제한 시간
    this.remainingTime = 1.0; // 남은 시간
    this.commandTimer = null; // 명령 타이머

    // 명령 (가중치 포함)
    this.commands = [
      { text: '청기 올려', expectedPose: '왼손 올리기', type: 'raise', weight: 35 },
      { text: '백기 올려', expectedPose: '오른손 올리기', type: 'raise', weight: 35 },
      { text: '둘 다 올려', expectedPose: '양손 올리기', type: 'raise', weight: 15 },
      { text: '청기 올리지 마', expectedPose: '기본', type: 'hold', weight: 5 },
      { text: '백기 올리지 마', expectedPose: '기본', type: 'hold', weight: 5 },
      { text: '둘 다 올리지 마', expectedPose: '기본', type: 'hold', weight: 5 }
    ];
    this.currentCommand = null;
    this.hasViolatedHold = false; // "올리지 마" 명령 위반 플래그

    // 게임 시간
    this.gameStartTime = 0;
    this.gameEndTime = 0;

    // 콜백
    this.onCommandIssued = null; // 명령 발급 콜백
    this.onRoundResult = null; // 라운드 결과 콜백 (success/fail)
    this.onLevelComplete = null; // 단계 클리어 콜백
    this.onGameOver = null; // 게임 오버 콜백
    this.onTimerTick = null; // 타이머 틱 콜백
    this.onStateChange = null; // 상태 변경 콜백
  }

  /**
   * 게임 시작
   */
  start() {
    this.isGameActive = true;
    this.isPaused = false;

    // 초기화
    this.level = 1;
    this.currentRound = 0;
    this.failCount = 0;
    this.totalSuccess = 0;
    this.gameStartTime = Date.now();

    // 1단계 시작
    this.currentTimeLimit = this.baseTimeLimit;
    this.notifyStateChange();

    // 첫 명령 발급 (짧은 딜레이 후)
    setTimeout(() => {
      this.issueNewCommand();
    }, 1000);
  }

  /**
   * 게임 중지
   */
  stop() {
    this.isGameActive = false;
    this.clearCommandTimer();
  }

  /**
   * 게임 일시정지
   */
  pause() {
    this.isPaused = true;
    this.clearCommandTimer();
  }

  /**
   * 게임 재개
   */
  resume() {
    if (!this.isGameActive) return;
    this.isPaused = false;
    // 타이머 재시작이 필요하면 여기서 처리
  }

  /**
   * 새로운 명령 발급
   */
  issueNewCommand() {
    if (!this.isGameActive || this.isPaused) return;

    // 5회 완료 체크
    if (this.currentRound >= 5) {
      this.completeLevel();
      return;
    }

    // 가중치 기반 랜덤 명령 선택
    this.currentCommand = this.selectWeightedCommand();

    // "올리지 마" 위반 플래그 초기화
    this.hasViolatedHold = false;

    // 남은 시간 초기화
    this.remainingTime = this.currentTimeLimit;

    // 명령 발급 콜백
    // 주의: 타이머는 TTS 발화가 끝난 후에 main.js에서 startCommandTimer()를 호출하여 시작됨
    if (this.onCommandIssued) {
      this.onCommandIssued({
        command: this.currentCommand,
        round: this.currentRound + 1,
        timeLimit: this.currentTimeLimit
      });
    }
  }

  /**
   * 가중치 기반 명령 선택
   * @returns {Object} 선택된 명령 객체
   */
  selectWeightedCommand() {
    // 전체 가중치 합계 계산
    const totalWeight = this.commands.reduce((sum, cmd) => sum + cmd.weight, 0);

    // 0 ~ totalWeight 범위의 랜덤 값 생성
    const random = Math.random() * totalWeight;

    // 누적 가중치를 기준으로 명령 선택
    let cumulativeWeight = 0;
    for (const command of this.commands) {
      cumulativeWeight += command.weight;
      if (random < cumulativeWeight) {
        return command;
      }
    }

    // 폴백 (발생하지 않아야 함)
    return this.commands[0];
  }

  /**
   * 명령 타이머 시작 (밀리초 단위로 정확하게)
   */
  startCommandTimer() {
    this.clearCommandTimer();
    this.isWaitingForPose = true; // 포즈 대기 시작

    const startTime = Date.now();
    const duration = this.currentTimeLimit * 1000; // 밀리초로 변환

    this.commandTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      this.remainingTime = Math.max(0, (duration - elapsed) / 1000);

      // 타이머 틱 콜백
      if (this.onTimerTick) {
        this.onTimerTick({
          remaining: this.remainingTime,
          total: this.currentTimeLimit,
          percentage: (this.remainingTime / this.currentTimeLimit) * 100
        });
      }

      // 시간 초과
      if (this.remainingTime <= 0) {
        this.clearCommandTimer();
        this.handleTimeout();
      }
    }, 16); // 약 60fps
  }

  /**
   * 명령 타이머 정리
   */
  clearCommandTimer() {
    if (this.commandTimer) {
      clearInterval(this.commandTimer);
      this.commandTimer = null;
    }
  }

  /**
   * 포즈 검증
   * @param {string} detectedPose - 감지된 포즈 ("기본", "왼손 올리기", "오른손 올리기", "양손 올리기")
   */
  verifyPose(detectedPose) {
    // 포즈 대기 중이 아니면 무시
    if (!this.isGameActive || this.isPaused || !this.currentCommand || !this.isWaitingForPose) {
      return;
    }

    // "올리지 마" 명령(type: 'hold')인 경우
    if (this.currentCommand.type === 'hold') {
      // 기본 포즈가 아닌 다른 포즈가 감지되면 위반으로 기록
      if (detectedPose !== '기본') {
        this.hasViolatedHold = true;
      }
      // "올리지 마" 명령은 시간 초과까지 대기해야 하므로 여기서는 성공 처리 안 함
      return;
    }

    // "올려" 명령(type: 'raise')인 경우
    const isCorrect = detectedPose === this.currentCommand.expectedPose;

    if (isCorrect) {
      this.handleSuccess();
    }
  }

  /**
   * 성공 처리
   */
  handleSuccess() {
    this.clearCommandTimer();
    this.isWaitingForPose = false; // 포즈 대기 종료

    this.totalSuccess++;
    this.currentRound++;

    // 성공 콜백
    if (this.onRoundResult) {
      this.onRoundResult({
        result: 'success',
        round: this.currentRound,
        failCount: this.failCount,
        totalSuccess: this.totalSuccess
      });
    }

    this.notifyStateChange();

    // 다음 명령 발급 (랜덤 대기: 0.5~1초)
    const randomDelay = 500 + Math.random() * 500;
    setTimeout(() => {
      this.issueNewCommand();
    }, randomDelay);
  }

  /**
   * 실패 처리 (시간 초과 또는 잘못된 포즈)
   */
  handleFailure() {
    this.clearCommandTimer();
    this.isWaitingForPose = false; // 포즈 대기 종료

    this.failCount++;
    this.currentRound++;

    // 실패 콜백
    if (this.onRoundResult) {
      this.onRoundResult({
        result: 'fail',
        round: this.currentRound,
        failCount: this.failCount,
        totalSuccess: this.totalSuccess
      });
    }

    this.notifyStateChange();

    // 2번 실패 시 게임 오버
    if (this.failCount >= 2) {
      setTimeout(() => {
        this.gameOver();
      }, 1000);
    } else {
      // 다음 명령 발급 (랜덤 대기: 0.5~1초)
      const randomDelay = 500 + Math.random() * 500;
      setTimeout(() => {
        this.issueNewCommand();
      }, randomDelay);
    }
  }

  /**
   * 시간 초과 처리
   */
  handleTimeout() {
    // "올리지 마" 명령(type: 'hold')인 경우
    if (this.currentCommand && this.currentCommand.type === 'hold') {
      // 위반하지 않았으면 성공
      if (!this.hasViolatedHold) {
        this.handleSuccess();
      } else {
        // 위반했으면 실패
        this.handleFailure();
      }
    } else {
      // "올려" 명령(type: 'raise')인 경우, 시간 초과는 실패
      this.handleFailure();
    }
  }

  /**
   * 단계 클리어
   */
  completeLevel() {
    if (this.failCount < 2) {
      // 단계 클리어 성공
      if (this.onLevelComplete) {
        this.onLevelComplete({
          level: this.level,
          failCount: this.failCount,
          totalSuccess: this.totalSuccess
        });
      }

      // 다음 단계 준비 (2초 대기 - 축포 애니메이션)
      setTimeout(() => {
        this.nextLevel();
      }, 2000);
    } else {
      // 2번 실패로 게임 오버
      this.gameOver();
    }
  }

  /**
   * 다음 단계 진입
   */
  nextLevel() {
    if (!this.isGameActive) return;

    this.level++;
    this.currentRound = 0;
    this.failCount = 0;

    // 제한 시간 감소 (최소값 유지)
    this.currentTimeLimit = Math.max(
      this.minTimeLimit,
      this.baseTimeLimit - (this.level - 1) * this.timeDecrement
    );

    // 최고 레벨 갱신
    if (this.level > this.maxLevel) {
      this.maxLevel = this.level;
    }

    this.notifyStateChange();

    // 다음 단계 첫 명령 발급
    setTimeout(() => {
      this.issueNewCommand();
    }, 500);
  }

  /**
   * 게임 오버
   */
  gameOver() {
    this.isGameActive = false;
    this.gameEndTime = Date.now();
    this.clearCommandTimer();

    const gameStats = this.getGameStats();

    // 최고 기록 저장
    this.saveHighScore(gameStats);

    // 게임 오버 콜백
    if (this.onGameOver) {
      this.onGameOver(gameStats);
    }
  }

  /**
   * 게임 통계 반환
   */
  getGameStats() {
    const playTime = this.gameEndTime - this.gameStartTime;
    const minutes = Math.floor(playTime / 60000);
    const seconds = Math.floor((playTime % 60000) / 1000);

    return {
      level: this.level,
      totalSuccess: this.totalSuccess,
      playTime: playTime,
      playTimeFormatted: `${minutes}:${seconds.toString().padStart(2, '0')}`
    };
  }

  /**
   * 최고 기록 저장 (Local Storage)
   */
  saveHighScore(stats) {
    try {
      const bestRecord = this.loadHighScore();

      let isNewRecord = false;

      // 최고 단계 갱신
      if (!bestRecord.bestLevel || stats.level > bestRecord.bestLevel) {
        bestRecord.bestLevel = stats.level;
        isNewRecord = true;
      }

      // 최다 성공 갱신
      if (!bestRecord.bestSuccess || stats.totalSuccess > bestRecord.bestSuccess) {
        bestRecord.bestSuccess = stats.totalSuccess;
        isNewRecord = true;
      }

      localStorage.setItem('bluewhite_highscore', JSON.stringify(bestRecord));

      return isNewRecord;
    } catch (error) {
      console.error('Failed to save high score:', error);
      return false;
    }
  }

  /**
   * 최고 기록 불러오기 (Local Storage)
   */
  loadHighScore() {
    try {
      const saved = localStorage.getItem('bluewhite_highscore');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load high score:', error);
    }

    return {
      bestLevel: 0,
      bestSuccess: 0
    };
  }

  /**
   * 상태 변경 알림
   */
  notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange(this.getGameState());
    }
  }

  /**
   * 현재 게임 상태 반환
   */
  getGameState() {
    return {
      isActive: this.isGameActive,
      isPaused: this.isPaused,
      level: this.level,
      round: this.currentRound,
      failCount: this.failCount,
      totalSuccess: this.totalSuccess,
      currentTimeLimit: this.currentTimeLimit,
      remainingTime: this.remainingTime,
      currentCommand: this.currentCommand
    };
  }

  /**
   * 콜백 설정 메서드들
   */
  setCommandIssuedCallback(callback) {
    this.onCommandIssued = callback;
  }

  setRoundResultCallback(callback) {
    this.onRoundResult = callback;
  }

  setLevelCompleteCallback(callback) {
    this.onLevelComplete = callback;
  }

  setGameOverCallback(callback) {
    this.onGameOver = callback;
  }

  setTimerTickCallback(callback) {
    this.onTimerTick = callback;
  }

  setStateChangeCallback(callback) {
    this.onStateChange = callback;
  }
}

// 전역으로 내보내기
window.GameEngine = GameEngine;
