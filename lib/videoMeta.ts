import type { Meta } from './estimate'

// Reads what the browser can learn about a clip before uploading it:
// size and duration from a <video> element, exact frame count and frame
// rate from the MP4/MOV container (via mp4box) when it has one.

function basicInfo(file: File) {
  return new Promise<{ w: number; h: number; d: number }>((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const url = URL.createObjectURL(file)
    const done = (r: { w: number; h: number; d: number }) => {
      URL.revokeObjectURL(url)
      resolve(r)
    }
    v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight, d: isFinite(v.duration) ? v.duration : 0 })
    v.onerror = () => done({ w: 0, h: 0, d: 0 })
    setTimeout(() => done({ w: 0, h: 0, d: 0 }), 15000)
    v.src = url
  })
}

type ContainerInfo = { frames: number; fps: number; width: number; height: number; duration: number }

async function containerInfo(file: File): Promise<ContainerInfo | null> {
  const { createFile, MP4BoxBuffer } = await import('mp4box')
  return new Promise((resolve) => {
    const mp4 = createFile()
    let settled = false
    const finish = (v: ContainerInfo | null) => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    mp4.onReady = (info) => {
      const t = info.videoTracks?.[0]
      if (!t || !t.timescale) return finish(null)
      const duration = t.duration / t.timescale
      const frames = t.nb_samples
      finish({
        frames,
        fps: duration > 0 && frames > 0 ? frames / duration : 0,
        width: t.video?.width ?? t.track_width,
        height: t.video?.height ?? t.track_height,
        duration,
      })
    }
    mp4.onError = () => finish(null)
    ;(async () => {
      const CH = 1 << 20
      let offset = 0
      let reads = 0
      try {
        while (!settled && offset < file.size && reads < 400) {
          reads++
          const ab = await file.slice(offset, offset + CH).arrayBuffer()
          const next = mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, offset))
          // mp4box tells us where the next box it needs starts, so a moov at the end of a big file costs only a couple of reads.
          offset = typeof next === 'number' && next > offset ? next : offset + ab.byteLength
        }
        mp4.flush()
      } catch {}
      finish(null)
    })()
  })
}

export async function readVideoMeta(file: File): Promise<Meta> {
  const [basic, cont] = await Promise.all([basicInfo(file), containerInfo(file).catch(() => null)])
  const width = basic.w || cont?.width || 0
  const height = basic.h || cont?.height || 0
  const duration = basic.d || cont?.duration || 0
  if (cont && cont.frames > 0 && cont.fps > 0) {
    return { width, height, duration, fps: Math.round(cont.fps * 1000) / 1000, frames: cont.frames, fpsSource: 'container' }
  }
  const fps = 24
  return { width, height, duration, fps, frames: Math.round(duration * fps), fpsSource: 'assumed' }
}
