// Errors the engine throws. ConfigError means the question bank is wrong, never the client.

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Invalid question bank configuration: ${message}`);
    this.name = 'ConfigError';
  }
}

export interface AnswerIssue {
  qid: string;
  code: string;
  message: string;
}

/** Answers that break a rule of the question (unknown option, exclusive combined, too many choices…). */
export class InvalidAnswerError extends Error {
  constructor(public readonly issues: AnswerIssue[]) {
    super(`Invalid answers: ${issues.map((i) => `${i.qid}: ${i.message}`).join('; ')}`);
    this.name = 'InvalidAnswerError';
  }
}

/** Visible questions are still unanswered. */
export class IncompleteAssessmentError extends Error {
  constructor(public readonly missing: string[]) {
    super(`The assessment is not complete; unanswered: ${missing.join(', ')}`);
    this.name = 'IncompleteAssessmentError';
  }
}

/** A flag with a `stop` effect fired (e.g. the age stop): no result may be produced. */
export class AssessmentStoppedError extends Error {
  constructor(public readonly flag: string) {
    super(`The assessment was stopped by flag ${flag}; no result is produced.`);
    this.name = 'AssessmentStoppedError';
  }
}
