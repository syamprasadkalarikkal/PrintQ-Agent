const supabase = require("./supabase");

const TABLE_NAME = process.env.PRINT_JOBS_TABLE || "print_jobs";
const STATUS_QUEUED = process.env.PRINT_STATUS_QUEUED || "queued";
const STATUS_PROCESSING = process.env.PRINT_STATUS_PROCESSING || "processing";
const STATUS_PRINTED = process.env.PRINT_STATUS_PRINTED || "completed";
const STATUS_FAILED = process.env.PRINT_STATUS_FAILED || "failed";

function uniqueStatuses(...statuses) {
  return [...new Set(statuses.filter(Boolean))];
}

function isStatusConstraintError(error) {
  return error?.code === "23514" || String(error?.message || "").includes("check constraint");
}

function queuedStatuses() {
  return uniqueStatuses(STATUS_QUEUED, "queued", "waiting", "pending");
}

async function getNextJob() {

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .in("status", queuedStatuses())
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw error;
  }

  return data || [];

}

async function updateJobStatus(job, statusCandidates) {

  if (!job?.id) return;

  const statuses = Array.isArray(statusCandidates)
    ? statusCandidates
    : [statusCandidates];

  let lastError = null;

  for (const status of statuses) {
    const { error } = await supabase
      .from(TABLE_NAME)
      .update({ status })
      .eq("id", job.id);

    if (!error) return status;

    lastError = error;
    if (!isStatusConstraintError(error)) throw error;
  }

  throw lastError;

}

async function claimNextJob() {

  const jobs = await getNextJob();
  const job = jobs[0];

  if (!job) return null;

  if (!job.id) {
    console.warn("Queued job has no id; processing without status claim.");
    return job;
  }

  const processingStatuses = uniqueStatuses(STATUS_PROCESSING, "processing", "printing");
  let lastError = null;

  for (const status of processingStatuses) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .update({ status })
      .eq("id", job.id)
      .in("status", queuedStatuses())
      .select("*")
      .maybeSingle();

    if (!error) return data;

    lastError = error;
    if (!isStatusConstraintError(error)) throw error;
  }

  throw lastError;

}

async function markJobPrinted(job) {
  await updateJobStatus(job, uniqueStatuses(STATUS_PRINTED, "completed", "complete", "printed", "done"));
}

async function markJobFailed(job) {
  await updateJobStatus(job, uniqueStatuses(STATUS_FAILED, "failed", "error"));
}

module.exports = {
  claimNextJob,
  getNextJob,
  markJobFailed,
  markJobPrinted,
};
