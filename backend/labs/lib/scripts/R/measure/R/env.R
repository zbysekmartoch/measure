.measure_env <- new.env(parent = emptyenv())

measure_init <- function(args = NULL) {
  if (is.null(args)) {
    args <- commandArgs(trailingOnly = TRUE)
  }

  if (length(args) < 3) {
    stop("Usage: script.R <resultDir> <runtimeEnvPath> <scriptsRoot>", call. = FALSE)
  }

  .measure_env$paths <- list(
    RESULT_ROOT = normalizePath(args[1], winslash = "/", mustWork = FALSE),
    RUNTIME_ENV_PATH = normalizePath(args[2], winslash = "/", mustWork = FALSE),
    WORKFLOW_ROOT = normalizePath(args[2], winslash = "/", mustWork = FALSE),
    LAB_ROOT = normalizePath(args[3], winslash = "/", mustWork = FALSE)
  )

  invisible(TRUE)
}

measure_paths <- function() {
  if (is.null(.measure_env$paths)) {
    measure_init()
  }
  .measure_env$paths
}

RESULT_ROOT <- function() {
  measure_paths()$RESULT_ROOT
}

RUNTIME_ENV_PATH <- function() {
  measure_paths()$RUNTIME_ENV_PATH
}

WORKFLOW_ROOT <- function() {
  measure_paths()$WORKFLOW_ROOT
}

LAB_ROOT <- function() {
  measure_paths()$LAB_ROOT
}
