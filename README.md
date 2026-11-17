# Spark Upscaler

A small web app for queueing [SeedVR2](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) video upscales on the community DGX Spark, and for learning how long they take.

- Upload a clip and see an estimate before you spend lab time.
- Book a Spark lab session and start the worker from the page.
- The worker runs inside the session, processes queued clips in resumable chunks, keeps the results on the Spark and reports timing for every chunk.
- Results download straight from the Spark to your browser.
- Those timings feed the estimates: `chunk seconds ≈ a + b × (frames × output megapixels)`, fitted per model and settings.

## How it fits together

| Piece | Where | What it does |
| --- | --- | --- |
| Web app | Vercel (Next.js) | Dashboard, upload, job queue, estimates, Spark booking |
| Redis (Upstash) | Vercel Storage | Jobs, worker status and timing stats |
| Blob (private) | Vercel Storage | Uploaded input videos until the worker has processed them, and the worker script |
| Worker | Spark lab session, `/workspace/upscaler` | Runs SeedVR2, keeps results in `/workspace/upscaler/outputs/<job>/`, talks to the app over HTTPS |

The Spark side uses the lab API documented at `https://spark.reagent-systems.com/docs/training` (bookings at `/api/lab/*` with a `spark-lab-…` token; the notebook at `https://spark-lab.reagent-systems.com/colab` while a session runs).

## Setup

1. Import this repo as a Vercel project (framework: Next.js).
2. Storage tab: connect a **Blob** store (private) and **Upstash for Redis** (free plan).
3. Environment variables:

   | Name | Value |
   | --- | --- |
   | `APP_PASSWORD` | Password for the dashboard |
   | `SPARK_LAB_TOKEN` | Your `spark-lab-…` token from the Spark training page |
   | `WORKER_SECRET` | A long random string, e.g. `openssl rand -hex 32` |

   Blob and Redis add their own variables when connected. Redeploy after changing variables.
4. Upload the worker script to Blob storage (the app serves it at `/worker.py`):

   ```bash
   curl -X PUT -H "Authorization: Bearer $WORKER_SECRET" --data-binary @worker-src/worker.py https://YOUR-APP/api/worker/script
   ```

## Using it

1. **Book a session** in the Spark card (whole hours, 7 PM–7 AM Eastern; a Chief approves it).
2. **Start the worker** while the session runs (Spark → Worker → Start Worker). The first start installs tools and downloads the model.
3. **Upload videos** any time. They wait in the queue until the worker runs.
4. **Download** results from the Jobs list. The Download link goes straight to the Spark's file API (`/api/lab/files/…`) and uses your Spark sign-in, so sign in at the Spark site in the same browser first. **Download via App** (in the ⋯ menu) streams the file through this app with the lab token instead; a Vercel function must finish within 5 minutes, so use it for files that transfer in that time.

Deleting a job queues its result for deletion; the worker removes it from the Spark the next time it runs (the Spark's file API is read-only).

`SU_DRY_RUN=1 python3 worker.py` runs the whole pipeline with a plain ffmpeg resize instead of SeedVR2, for testing without a GPU. Dry-run timings are not added to the stats.

## Development

```bash
npm install
npm run dev
```

UI: shadcn/ui components (`components/ui`), Motion (`motion/react`) for transitions, black and white only, following the [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines).
