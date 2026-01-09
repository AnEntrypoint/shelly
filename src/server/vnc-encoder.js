import { spawn } from 'child_process';

class VncEncoder {
  constructor(session_id) {
    this.session_id = session_id;
    this.ffmpeg_process = null;
    this.is_encoding = false;
    this.frame_count = 0;
    this.last_frame_time = Date.now();
  }

  init_display_encoder(vnc_host = 'localhost', vnc_port = 5900, width = 1024, height = 768, framerate = 5) {
    if (this.ffmpeg_process) {
      return this.ffmpeg_process.stdout;
    }

    // Use x11grab to capture Xvfb display :99 instead of VNC (VNC input format not available in FFmpeg)
    const display = process.env.DISPLAY || ':99';
    const ffmpeg_args = [
      '-f', 'x11grab',
      '-framerate', framerate.toString(),
      '-video_size', `${width}x${height}`,
      '-i', `${display}.0`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      '-frag_duration', '500',
      'pipe:1'
    ];

    this.ffmpeg_process = spawn('ffmpeg', ffmpeg_args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DISPLAY: display }
    });

    if (!this.ffmpeg_process.stdout) {
      throw new Error('FFmpeg stdout not available');
    }

    this.is_encoding = true;
    this.log_state('h264_encoder_started', null, `X11 display ${display}@${width}x${height}@${framerate}fps with MP4 fragmentation`, 'encoder_init');
    return this.ffmpeg_process.stdout;
  }

  log_state(variable, prev_val, next_val, causation) {
    const timestamp = new Date().toISOString();
    const stack = new Error().stack.split('\n')[2]?.trim() || 'unknown';
    console.log(JSON.stringify({
      timestamp,
      var: variable,
      prev: prev_val,
      next: next_val,
      causation,
      stack,
      session_id: this.session_id
    }));
  }

  on_frame(callback) {
    if (!this.ffmpeg_process || !this.ffmpeg_process.stdout) {
      return;
    }

    this.ffmpeg_process.stdout.on('data', (chunk) => {
      this.frame_count++;
      const now = Date.now();
      const elapsed = now - this.last_frame_time;

      if (elapsed >= 5000) {
        this.log_state('encoder_throughput', `${this.frame_count}_chunks`, `${(this.frame_count * 1000 / elapsed).toFixed(1)}_chunks_per_sec`, 'encoder_stats');
        this.frame_count = 0;
        this.last_frame_time = now;
      }

      callback(chunk);
    });

    this.ffmpeg_process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('frame=')) {
        this.log_state('ffmpeg_stderr', null, msg.substring(0, 100), 'encoder_debug');
      }
    });

    this.ffmpeg_process.on('error', (err) => {
      this.log_state('ffmpeg_error', null, err.message, 'encoder_error');
    });

    this.ffmpeg_process.on('close', (code) => {
      this.is_encoding = false;
      this.log_state('ffmpeg_closed', 'encoding', `code_${code}`, 'encoder_terminated');
    });
  }

  close() {
    if (this.ffmpeg_process) {
      try {
        this.ffmpeg_process.kill('SIGTERM');
      } catch {}
      this.ffmpeg_process = null;
    }
    this.is_encoding = false;
    this.log_state('vnc_encoder_closed', 'encoding', 'terminated', 'encoder_close');
  }
}

export { VncEncoder };
