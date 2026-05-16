const supabase = require("./supabase");

const TABLE_NAME = process.env.PRINT_JOBS_TABLE || "print_jobs";
const STORAGE_BUCKET = process.env.PRINT_STORAGE_BUCKET || "print-queue";
const DEFAULT_CLEANUP_DELAY_MS = 0;

function configuredCleanupDelay() {
  if (process.env.PRINT_CLEANUP_DELAY_MS === undefined) {
    return DEFAULT_CLEANUP_DELAY_MS;
  }

  const delayMs = Number(process.env.PRINT_CLEANUP_DELAY_MS);
  return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : DEFAULT_CLEANUP_DELAY_MS;
}

const CLEANUP_DELAY_MS = configuredCleanupDelay();

function jobLabel(job) {
  return job?.id || job?.customer_token || job?.token || job?.file_path || "unknown job";
}

async function removeStoredPdf(job) {
  if (!job?.file_path) return;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([job.file_path]);

  if (error) throw error;
}

async function removeJobRow(job) {
  if (job?.id) {
    const { error } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq("id", job.id);

    if (error) throw error;
    return;
  }

  if (job?.customer_token && job?.file_path) {
    const { error } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq("customer_token", job.customer_token)
      .eq("file_path", job.file_path);

    if (error) throw error;
    return;
  }

  throw new Error("Cannot delete print job row without id or customer_token plus file_path.");
}

async function cleanupPrintedJob(job) {
  await removeStoredPdf(job);
  await removeJobRow(job);
  console.log(`Removed printed job ${jobLabel(job)} from Supabase table and storage.`);
}

function schedulePrintedJobCleanup(job, delayMs = CLEANUP_DELAY_MS) {
  if (!job) return null;

  const timer = setTimeout(async () => {
    try {
      await cleanupPrintedJob(job);
    } catch (error) {
      console.error(`Failed to clean up printed job ${jobLabel(job)}:`, error);
    }
  }, Math.max(Number(delayMs) || 0, 0));

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  console.log(
    `Scheduled Supabase cleanup for printed job ${jobLabel(job)} in ${Math.round(
      Math.max(Number(delayMs) || 0, 0) / 1000
    )} seconds.`
  );

  return timer;
}

module.exports = {
  CLEANUP_DELAY_MS,
  cleanupPrintedJob,
  schedulePrintedJobCleanup,
};
