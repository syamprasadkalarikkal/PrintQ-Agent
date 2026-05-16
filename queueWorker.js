const {
  claimNextJob,
  markJobFailed,
  markJobPrinted,
} = require("./queue");
const downloadAndPrint = require("./printer");
const {
  CLEANUP_DELAY_MS,
  cleanupPrintedJob,
  schedulePrintedJobCleanup,
} = require("./cleanup");

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 5000;
let isProcessing = false;

async function processNextJob() {

  if (isProcessing) return null;

  isProcessing = true;
  let job = null;

  try {
    job = await claimNextJob();

    if (!job) return null;

    console.log(`Printing queued job ${job.id || job.customer_token || job.token}`);

    try {
      await downloadAndPrint(job);
    } catch (printError) {
      try {
        await markJobFailed(job);
      } catch (statusError) {
        console.error("Failed to mark job as failed:", statusError);
      }

      throw printError;
    }

    try {
      await markJobPrinted(job);
    } catch (statusError) {
      console.error("Printed job, but failed to update status:", statusError);
    }

    if (CLEANUP_DELAY_MS <= 0) {
      try {
        await cleanupPrintedJob(job);
      } catch (cleanupError) {
        console.error("Printed job, but failed to clean up Supabase files:", cleanupError);
      }
    } else {
      schedulePrintedJobCleanup(job);
    }

    return job;
  } catch (error) {
    console.error("Print queue error:", error);
    return null;
  } finally {
    isProcessing = false;
  }

}

function startQueueWorker() {

  console.log(`PrintQ agent polling every ${POLL_INTERVAL_MS}ms`);
  processNextJob();
  return setInterval(processNextJob, POLL_INTERVAL_MS);

}

module.exports = {
  processNextJob,
  startQueueWorker,
};
