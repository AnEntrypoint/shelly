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

    const vnc_url = `vnc://${vnc_host}:${vnc_port}`;
    const ffmpeg_args = [
      '-f', 'vnc',
      '-framerate', framerate.toString(),
      '-video_size', `${width}x${height}`,
      '-i', vnc_url,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-f', 'h264',
      'pipe:1'
    ];

    this.ffmpeg_process = spawn('ffmpeg', ffmpeg_args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (!this.ffmpeg_process.stdout) {
      throw new Error('FFmpeg stdout not available');
    }

    this.is_encoding = true;
    this.log_state('h264_encoder_started', null, `${vnc_url}@${width}x${height}@${framerate}fps`, 'encoder_init');
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
