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

  // 사용자 인터랙션 직후 TTS 초기화 (브라우저 autoplay policy 우회)
  if ('speechSynthesis' in window) {
    // Chrome에서는 실제 발화를 해야 TTS가 활성화됨
    const initUtterance = new SpeechSynthesisUtterance('안녕');
    initUtterance.volume = 0.01; // 거의 무음 (완전 무음은 Chrome에서 무시됨)
    initUtterance.rate = 10; // 매우 빠르게 (즉시 끝나도록)

    initUtterance.onend = () => {
      console.log('✅ TTS initialized successfully');
    };

    initUtterance.onerror = (e) => {
      console.log('TTS init error (expected):', e.error);
    };

    window.speechSynthesis.speak(initUtterance);

    console.log('TTS initialization started');
  }

  try {
    await initializeGame();

    // AudioContext 활성화 (사용자 인터랙션)
    if (audioManager && audioManager.audioContext) {
      audioManager.resume();
    }

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
    // TTS 재생 후 타이머 시작
    playTTS(data.command.text, () => {
      // TTS 발화가 끝난 후 타이머 시작
      if (gameEngine && gameEngine.isGameActive) {
        gameEngine.startCommandTimer();
      }
    });
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
 * @param {string} text - 읽을 텍스트
 * @param {Function} onEndCallback - 발화 종료 시 호출할 콜백 (선택사항)
 */
function playTTS(text, onEndCallback) {
  if (!('speechSynthesis' in window)) {
    console.warn('TTS not supported in this browser');
    if (onEndCallback) onEndCallback(); // TTS 미지원 시에도 게임 진행
    return;
  }

  console.log('🔊 Speaking:', text);

  // AudioContext가 있으면 resume (사용자 인터랙션 확보)
  if (audioManager && audioManager.audioContext) {
    audioManager.resume();
  }

  // 기존 발화가 있으면 취소 (큐에 쌓이지 않도록)
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    console.log('Canceling previous TTS');
    window.speechSynthesis.cancel();
    // cancel 후 약간의 딜레이
    setTimeout(() => {
      actuallySpeak(text, onEndCallback);
    }, 100);
  } else {
    actuallySpeak(text, onEndCallback);
  }
}

function actuallySpeak(text, onEndCallback) {
  // 사용 가능한 음성 목록 확인
  const voices = window.speechSynthesis.getVoices();
  console.log('Available voices:', voices.length);
  const koVoices = voices.filter(v => v.lang.startsWith('ko'));
  console.log('Korean voices:', koVoices.map(v => `${v.name} (${v.lang})`));

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';

  // 한국어 여성 음성 우선 선택 (유나, Yuna, 여성 목소리)
  let selectedVoice = null;

  // 1순위: "유나" 또는 "Yuna" 찾기
  selectedVoice = koVoices.find(v => v.name.includes('유나') || v.name.toLowerCase().includes('yuna'));

  // 2순위: "여" 또는 "Female" 포함된 음성
  if (!selectedVoice) {
    selectedVoice = koVoices.find(v =>
      v.name.includes('여') ||
      v.name.toLowerCase().includes('female') ||
      v.name.includes('Flo') ||
      v.name.includes('Shelley') ||
      v.name.includes('Sandy')
    );
  }

  // 3순위: Google 한국어 음성 (Chrome)
  if (!selectedVoice) {
    selectedVoice = koVoices.find(v =>
      v.name.toLowerCase().includes('google') &&
      v.lang === 'ko-KR'
    );
  }

  // 4순위: 첫 번째 한국어 음성
  if (!selectedVoice && koVoices.length > 0) {
    selectedVoice = koVoices[0];
  }

  if (selectedVoice) {
    utterance.voice = selectedVoice;
    console.log('Selected voice:', selectedVoice.name, '/', selectedVoice.lang);
  } else {
    console.warn('No Korean voice found, using default');
  }

  // Chrome에서 안정적인 설정
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  let hasEnded = false;

  utterance.onstart = () => {
    console.log('✅ TTS started');
  };

  utterance.onend = () => {
    if (hasEnded) return; // 중복 호출 방지
    hasEnded = true;
    console.log('✅ TTS ended');
    // 발화 종료 후 콜백 호출
    if (onEndCallback) {
      onEndCallback();
    }
  };

  utterance.onerror = (event) => {
    console.error('❌ TTS error:', event.error);
    // 에러 발생 시에도 콜백 호출 (게임이 멈추지 않도록)
    if (onEndCallback && event.error !== 'canceled' && !hasEnded) {
      hasEnded = true;
      onEndCallback();
    }
  };

  console.log('Calling speak()...');
  window.speechSynthesis.speak(utterance);

  // 상태 체크 (약간의 지연 후)
  setTimeout(() => {
    console.log('After 100ms - speaking:', window.speechSynthesis.speaking, 'pending:', window.speechSynthesis.pending);
  }, 100);

  // Chrome 버그 해결: 일정 시간 후에도 speaking이 true인데 소리가 안나면 강제 재시작
  setTimeout(() => {
    if (window.speechSynthesis.speaking && !hasEnded) {
      console.warn('⚠️ TTS stuck, attempting resume...');
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  }, 500);
}

/**
 * 효과음 재생
 */
function playSound(type) {
  if (audioManager) {
    audioManager.play(type);
  }
}
