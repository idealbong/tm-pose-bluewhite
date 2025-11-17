/**
 * main.js
 * 청기백기 게임의 진입점 - UI, 포즈 인식, 게임 로직을 연결
 */

// 전역 변수
let poseEngine;
let gameEngine;
let stabilizer;
let audioManager;
let ctx;
let labelContainer;

// UI 요소
let elements = {};

/**
 * 페이지 로드 시 초기화
 */
document.addEventListener('DOMContentLoaded', () => {
  // UI 요소 참조
  elements = {
    // 화면
    startScreen: document.getElementById('start-screen'),
    gameScreen: document.getElementById('game-screen'),
    gameoverScreen: document.getElementById('gameover-screen'),

    // 버튼
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    restartBtn: document.getElementById('restartBtn'),

    // 게임 정보
    levelDisplay: document.getElementById('level-display'),
    progressDisplay: document.getElementById('progress-display'),
    failsDisplay: document.getElementById('fails-display'),
    timerDisplay: document.getElementById('timer-display'),
    timerBar: document.getElementById('timer-bar'),

    // 깃발
    blueFlag: document.getElementById('blue-flag'),
    whiteFlag: document.getElementById('white-flag'),

    // 명령 및 신호등
    commandDisplay: document.getElementById('command-display'),
    trafficLight: document.getElementById('traffic-light'),
    lightGreen: document.getElementById('light-green'),
    lightYellow: document.getElementById('light-yellow'),
    lightRed: document.getElementById('light-red'),

    // 캔버스
    canvas: document.getElementById('canvas'),
    labelContainer: document.getElementById('label-container'),

    // 게임 오버 화면
    finalLevel: document.getElementById('final-level'),
    finalSuccess: document.getElementById('final-success'),
    finalTime: document.getElementById('final-time'),
    bestLevel: document.getElementById('best-level'),
    bestSuccess: document.getElementById('best-success'),
    newRecordMessage: document.getElementById('new-record-message'),

    // 축포 컨테이너
    confettiContainer: document.getElementById('confetti-container')
  };

  // 이벤트 리스너 등록
  elements.startBtn.addEventListener('click', handleStart);
  elements.stopBtn.addEventListener('click', handleStop);
  elements.restartBtn.addEventListener('click', handleRestart);
});

/**
 * 게임 시작 버튼 클릭
 */
async function handleStart() {
  elements.startBtn.disabled = true;
  elements.startBtn.textContent = '초기화 중...';

  try {
    await initializeGame();
    switchScreen('game');
    startGame();
  } catch (error) {
    console.error('게임 초기화 실패:', error);
    alert('게임 초기화에 실패했습니다. 카메라 권한을 확인해주세요.');
    elements.startBtn.disabled = false;
    elements.startBtn.textContent = '게임 시작';
  }
}

/**
 * 게임 중지 버튼 클릭
 */
function handleStop() {
  if (gameEngine) {
    gameEngine.stop();
  }
  if (poseEngine) {
    poseEngine.stop();
  }
  switchScreen('start');
  elements.startBtn.disabled = false;
  elements.startBtn.textContent = '게임 시작';
}

/**
 * 게임 재시작 버튼 클릭
 */
function handleRestart() {
  switchScreen('game');
  resetUI();
  startGame();
}

/**
 * 게임 초기화 (포즈 엔진, 게임 엔진)
 */
async function initializeGame() {
  // 0. TTS 초기화 (음성 목록 로드)
  if ('speechSynthesis' in window) {
    // 음성 목록 강제 로드
    window.speechSynthesis.getVoices();
    // 음성 변경 이벤트 리스너
    window.speechSynthesis.onvoiceschanged = () => {
      console.log('TTS voices loaded:', window.speechSynthesis.getVoices().length);
    };
  }

  // 1. PoseEngine 초기화
  poseEngine = new PoseEngine('./my_model/');
  const { maxPredictions } = await poseEngine.init({
    size: 400,
    flip: true
  });

  // 2. Stabilizer 초기화
  stabilizer = new PredictionStabilizer({
    threshold: 0.8, // 높은 임계값으로 정확도 향상
    smoothingFrames: 2 // 빠른 반응을 위해 프레임 수 줄임
  });

  // 3. AudioManager 초기화
  audioManager = new AudioManager();

  // 4. GameEngine 초기화
  gameEngine = new GameEngine();
  setupGameCallbacks();

  // 4. 캔버스 설정
  ctx = elements.canvas.getContext('2d');
  elements.canvas.width = 400;
  elements.canvas.height = 400;

  // 5. Label Container 설정 (디버그용)
  elements.labelContainer.innerHTML = '';
  for (let i = 0; i < maxPredictions; i++) {
    elements.labelContainer.appendChild(document.createElement('div'));
  }

  // 6. PoseEngine 콜백 설정
  poseEngine.setPredictionCallback(handlePrediction);
  poseEngine.setDrawCallback(drawPose);

  // 7. PoseEngine 시작
  poseEngine.start();
}

/**
 * 게임 엔진 콜백 설정
 */
function setupGameCallbacks() {
  // 명령 발급 시
  gameEngine.setCommandIssuedCallback((data) => {
    updateCommand(data.command.text);
    playTTS(data.command.text);
  });

  // 라운드 결과 시
  gameEngine.setRoundResultCallback((data) => {
    if (data.result === 'success') {
      playSound('success');
      updateTrafficLight('green');
    } else {
      playSound('fail');
      if (data.failCount === 1) {
        updateTrafficLight('yellow');
        playSound('warning');
      } else if (data.failCount === 2) {
        updateTrafficLight('red');
        playSound('gameover');
      }
    }
    updateGameInfo();
  });

  // 단계 클리어 시
  gameEngine.setLevelCompleteCallback((data) => {
    updateTrafficLight('green');
    playSound('levelcomplete');
    showConfetti();
    updateCommand(`단계 ${data.level} 클리어! 🎉`);
  });

  // 게임 오버 시
  gameEngine.setGameOverCallback((stats) => {
    setTimeout(() => {
      showGameOverScreen(stats);
    }, 1500);
  });

  // 타이머 틱 시
  gameEngine.setTimerTickCallback((data) => {
    updateTimer(data);
  });

  // 상태 변경 시
  gameEngine.setStateChangeCallback((state) => {
    updateGameInfo();
  });
}

/**
 * 게임 시작
 */
function startGame() {
  resetUI();
  updateTrafficLight('none');
  gameEngine.start();
}

/**
 * 포즈 예측 처리
 */
function handlePrediction(predictions, pose) {
  // 1. 안정화
  const stabilized = stabilizer.stabilize(predictions);

  // 2. 디버그 정보 업데이트
  for (let i = 0; i < predictions.length; i++) {
    const classPrediction =
      predictions[i].className + ': ' + predictions[i].probability.toFixed(2);
    elements.labelContainer.childNodes[i].innerHTML = classPrediction;
  }

  // 3. 깃발 업데이트
  updateFlags(stabilized.className);

  // 4. 게임 엔진에 포즈 전달
  if (gameEngine && gameEngine.isGameActive && stabilized.className) {
    gameEngine.verifyPose(stabilized.className);
  }
}

/**
 * 포즈 그리기
 */
function drawPose(pose) {
  if (poseEngine.webcam && poseEngine.webcam.canvas) {
    ctx.drawImage(poseEngine.webcam.canvas, 0, 0);

    // 키포인트와 스켈레톤 그리기
    if (pose) {
      const minPartConfidence = 0.5;
      tmPose.drawKeypoints(pose.keypoints, minPartConfidence, ctx);
      tmPose.drawSkeleton(pose.keypoints, minPartConfidence, ctx);
    }
  }
}

/**
 * 화면 전환
 */
function switchScreen(screen) {
  elements.startScreen.classList.remove('active');
  elements.gameScreen.classList.remove('active');
  elements.gameoverScreen.classList.remove('active');

  if (screen === 'start') {
    elements.startScreen.classList.add('active');
  } else if (screen === 'game') {
    elements.gameScreen.classList.add('active');
  } else if (screen === 'gameover') {
    elements.gameoverScreen.classList.add('active');
  }
}

/**
 * UI 초기화
 */
function resetUI() {
  updateCommand('명령을 기다리는 중...');
  updateGameInfo();
  updateTrafficLight('none');
  clearConfetti();
}

/**
 * 게임 정보 업데이트
 */
function updateGameInfo() {
  const state = gameEngine.getGameState();

  elements.levelDisplay.textContent = state.level;
  elements.progressDisplay.textContent = `${state.round}/5`;
  elements.failsDisplay.textContent = state.failCount;
  elements.timerDisplay.textContent = `${state.currentTimeLimit.toFixed(1)}s`;
}

/**
 * 명령 표시 업데이트
 */
function updateCommand(text) {
  elements.commandDisplay.textContent = text;
  elements.commandDisplay.classList.remove('pulse');
  setTimeout(() => {
    elements.commandDisplay.classList.add('pulse');
  }, 10);
}

/**
 * 타이머 바 업데이트
 */
function updateTimer(data) {
  const percentage = data.percentage;
  elements.timerBar.style.width = `${percentage}%`;

  // 색상 변경
  elements.timerBar.classList.remove('warning', 'danger');
  if (percentage < 30) {
    elements.timerBar.classList.add('danger');
  } else if (percentage < 50) {
    elements.timerBar.classList.add('warning');
  }
}

/**
 * 신호등 업데이트
 */
function updateTrafficLight(color) {
  elements.lightGreen.classList.remove('active');
  elements.lightYellow.classList.remove('active');
  elements.lightRed.classList.remove('active');

  if (color === 'green') {
    elements.lightGreen.classList.add('active');
  } else if (color === 'yellow') {
    elements.lightYellow.classList.add('active');
  } else if (color === 'red') {
    elements.lightRed.classList.add('active');
  }
}

/**
 * 깃발 상태 업데이트
 */
function updateFlags(poseName) {
  // 청기 (왼손)
  if (poseName === '왼손 올리기' || poseName === '양손 올리기') {
    elements.blueFlag.classList.add('raised');
  } else {
    elements.blueFlag.classList.remove('raised');
  }

  // 백기 (오른손)
  if (poseName === '오른손 올리기' || poseName === '양손 올리기') {
    elements.whiteFlag.classList.add('raised');
  } else {
    elements.whiteFlag.classList.remove('raised');
  }
}

/**
 * 축포 애니메이션 표시
 */
function showConfetti() {
  clearConfetti();

  const colors = ['#f44336', '#e91e63', '#9c27b0', '#2196f3', '#4caf50', '#ffeb3b'];

  for (let i = 0; i < 100; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = Math.random() * 100 + '%';
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDelay = Math.random() * 0.5 + 's';
    confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
    elements.confettiContainer.appendChild(confetti);
  }

  // 3초 후 제거
  setTimeout(clearConfetti, 3000);
}

/**
 * 축포 제거
 */
function clearConfetti() {
  elements.confettiContainer.innerHTML = '';
}

/**
 * 게임 오버 화면 표시
 */
function showGameOverScreen(stats) {
  const highScore = gameEngine.loadHighScore();
  const isNewRecord = gameEngine.saveHighScore(stats);

  // 현재 기록
  elements.finalLevel.textContent = `${stats.level} 단계`;
  elements.finalSuccess.textContent = `${stats.totalSuccess}회`;
  elements.finalTime.textContent = stats.playTimeFormatted;

  // 최고 기록
  elements.bestLevel.textContent = `${highScore.bestLevel} 단계`;
  elements.bestSuccess.textContent = `${highScore.bestSuccess}회`;

  // 신기록 메시지
  if (isNewRecord) {
    elements.newRecordMessage.classList.add('show');
    showConfetti();
  } else {
    elements.newRecordMessage.classList.remove('show');
  }

  switchScreen('gameover');
}

/**
 * TTS 음성 출력
 */
function playTTS(text) {
  if ('speechSynthesis' in window) {
    // 진행 중인 음성이 있으면 중단하고 재시작
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
      // cancel 후 충분한 딜레이 필요
      setTimeout(() => playTTSInternal(text), 200);
    } else {
      playTTSInternal(text);
    }
  } else {
    console.warn('TTS not supported in this browser');
  }
}

/**
 * 내부 TTS 실행 함수
 */
function playTTSInternal(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  utterance.rate = 1.3; // 빠르게
  utterance.pitch = 1.1;
  utterance.volume = 1.0;

  // 음성 목록이 로드되지 않았을 경우 대비
  const voices = window.speechSynthesis.getVoices();
  const koreanVoice = voices.find(voice => voice.lang.startsWith('ko'));
  if (koreanVoice) {
    utterance.voice = koreanVoice;
  }

  // 에러 핸들링
  utterance.onerror = (event) => {
    console.error('TTS Error:', event.error);
    // 에러 발생 시 재시도 (무한 루프 방지)
    if (event.error === 'canceled' || event.error === 'interrupted') {
      console.log('TTS was cancelled, this is normal');
    }
  };

  utterance.onstart = () => {
    console.log('TTS started:', text);
  };

  utterance.onend = () => {
    console.log('TTS ended:', text);
  };

  try {
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error('Failed to speak:', error);
  }
}

/**
 * 효과음 재생
 */
function playSound(type) {
  if (audioManager) {
    audioManager.play(type);
  }
}
