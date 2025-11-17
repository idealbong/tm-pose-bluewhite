/**
 * audioManager.js
 * 게임 효과음 및 배경 음악 관리
 *
 * Web Audio API를 사용하여 간단한 비프음 생성
 * 실제 오디오 파일이 있으면 교체 가능
 */

class AudioManager {
  constructor() {
    // Web Audio API 초기화
    this.audioContext = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;

    // 볼륨 설정
    this.masterVolume = 0.7;
    this.bgmVolume = 0.3;
    this.sfxVolume = 0.5;

    // 배경 음악
    this.bgm = null;
    this.isBgmPlaying = false;

    // 사운드 버퍼 (미래 확장용)
    this.sounds = {};

    this.init();
  }

  /**
   * Audio Context 초기화
   */
  init() {
    try {
      // AudioContext 생성 (브라우저 호환성)
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();

      // Master Gain Node
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.audioContext.destination);

      // BGM Gain Node
      this.bgmGain = this.audioContext.createGain();
      this.bgmGain.gain.value = this.bgmVolume;
      this.bgmGain.connect(this.masterGain);

      // SFX Gain Node
      this.sfxGain = this.audioContext.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.masterGain);
    } catch (error) {
      console.warn('Web Audio API not supported:', error);
    }
  }

  /**
   * AudioContext 재개 (사용자 인터랙션 필요)
   */
  resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  /**
   * 비프음 생성 (Web Audio API)
   */
  playBeep(frequency = 440, duration = 0.1, type = 'sine') {
    if (!this.audioContext) return;

    this.resume();

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.sfxGain);

    oscillator.frequency.value = frequency;
    oscillator.type = type;

    // 엔벨로프 (ADSR)
    const now = this.audioContext.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01); // Attack
    gainNode.gain.linearRampToValueAtTime(0.2, now + 0.05); // Decay
    gainNode.gain.setValueAtTime(0.2, now + duration - 0.05); // Sustain
    gainNode.gain.linearRampToValueAtTime(0, now + duration); // Release

    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  /**
   * 성공 효과음
   */
  playSuccess() {
    this.playBeep(880, 0.15, 'sine'); // 높은 음
    setTimeout(() => {
      this.playBeep(1320, 0.15, 'sine'); // 더 높은 음
    }, 100);
  }

  /**
   * 실패 효과음
   */
  playFail() {
    this.playBeep(220, 0.3, 'sawtooth'); // 낮은 음, 거친 파형
  }

  /**
   * 경고음 (첫 번째 실패)
   */
  playWarning() {
    this.playBeep(440, 0.2, 'square');
    setTimeout(() => {
      this.playBeep(440, 0.2, 'square');
    }, 250);
  }

  /**
   * 게임 오버 사운드
   */
  playGameOver() {
    this.playBeep(440, 0.2, 'sawtooth');
    setTimeout(() => {
      this.playBeep(392, 0.2, 'sawtooth');
    }, 200);
    setTimeout(() => {
      this.playBeep(349, 0.4, 'sawtooth');
    }, 400);
  }

  /**
   * 단계 클리어 사운드
   */
  playLevelComplete() {
    const melody = [
      { freq: 523, dur: 0.15 }, // C5
      { freq: 659, dur: 0.15 }, // E5
      { freq: 784, dur: 0.15 }, // G5
      { freq: 1047, dur: 0.3 }  // C6
    ];

    let delay = 0;
    melody.forEach((note) => {
      setTimeout(() => {
        this.playBeep(note.freq, note.dur, 'sine');
      }, delay);
      delay += note.dur * 1000;
    });
  }

  /**
   * 배경 음악 시작 (간단한 루프)
   */
  startBGM() {
    if (this.isBgmPlaying) return;
    if (!this.audioContext) return;

    this.resume();
    this.isBgmPlaying = true;

    // 간단한 배경 멜로디 루프
    this.playBGMLoop();
  }

  /**
   * 배경 음악 루프
   */
  playBGMLoop() {
    if (!this.isBgmPlaying) return;

    const melody = [
      { freq: 523, dur: 0.4 }, // C5
      { freq: 587, dur: 0.4 }, // D5
      { freq: 659, dur: 0.4 }, // E5
      { freq: 523, dur: 0.4 }  // C5
    ];

    let delay = 0;
    melody.forEach((note, index) => {
      setTimeout(() => {
        if (this.isBgmPlaying) {
          this.playBGMNote(note.freq, note.dur);
        }

        // 마지막 노트 후 루프 재시작
        if (index === melody.length - 1) {
          setTimeout(() => {
            this.playBGMLoop();
          }, note.dur * 1000);
        }
      }, delay);
      delay += note.dur * 1000;
    });
  }

  /**
   * 배경 음악 노트 재생
   */
  playBGMNote(frequency, duration) {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.bgmGain);

    oscillator.frequency.value = frequency;
    oscillator.type = 'triangle';

    const now = this.audioContext.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.1, now + 0.05);
    gainNode.gain.linearRampToValueAtTime(0.05, now + duration - 0.1);
    gainNode.gain.linearRampToValueAtTime(0, now + duration);

    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  /**
   * 배경 음악 중지
   */
  stopBGM() {
    this.isBgmPlaying = false;
  }

  /**
   * 마스터 볼륨 설정
   */
  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this.masterVolume;
    }
  }

  /**
   * 효과음 볼륨 설정
   */
  setSFXVolume(volume) {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    if (this.sfxGain) {
      this.sfxGain.gain.value = this.sfxVolume;
    }
  }

  /**
   * 배경 음악 볼륨 설정
   */
  setBGMVolume(volume) {
    this.bgmVolume = Math.max(0, Math.min(1, volume));
    if (this.bgmGain) {
      this.bgmGain.gain.value = this.bgmVolume;
    }
  }

  /**
   * 효과음 재생 (편의 메서드)
   */
  play(type) {
    switch (type) {
      case 'success':
        this.playSuccess();
        break;
      case 'fail':
        this.playFail();
        break;
      case 'warning':
        this.playWarning();
        break;
      case 'gameover':
        this.playGameOver();
        break;
      case 'levelcomplete':
        this.playLevelComplete();
        break;
      default:
        console.warn(`Unknown sound type: ${type}`);
    }
  }
}

// 전역으로 내보내기
window.AudioManager = AudioManager;
