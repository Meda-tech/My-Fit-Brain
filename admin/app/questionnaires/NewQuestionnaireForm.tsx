'use client';

import { useActionState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Card, Notice, inputClasses, labelClasses } from '../../components/brand';
import { createQuestionnaireAction, type FormState } from './actions';

export function NewQuestionnaireForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createQuestionnaireAction, { error: null });
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-[20px] font-semibold text-teal">New questionnaire</h2>
      <p className="mt-1 text-[14px] text-ink-muted">A code and a report ID prefix that never change, and the name clients see.</p>
      <form action={action} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="code" className={labelClasses}>
            Code
          </label>
          <input id="code" name="code" required maxLength={8} placeholder="e.g. SA" className={`${inputClasses} uppercase`} />
        </div>
        <div>
          <label htmlFor="report_prefix" className={labelClasses}>
            Report ID prefix
          </label>
          <input id="report_prefix" name="report_prefix" required maxLength={16} placeholder="e.g. MFB-SA" className={`${inputClasses} uppercase`} />
        </div>
        <div>
          <label htmlFor="name_en" className={labelClasses}>
            Name (English)
          </label>
          <input id="name_en" name="name_en" required placeholder="MFB Sleep Assessment" className={inputClasses} />
        </div>
        <div>
          <label htmlFor="name_hi" className={labelClasses}>
            Name (Hindi)
          </label>
          <input id="name_hi" name="name_hi" lang="hi" placeholder="MFB नींद असेसमेंट" className={inputClasses} />
        </div>
        {state.error && (
          <Notice variant="error" role="alert" className="sm:col-span-2">
            {state.error}
          </Notice>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" loading={pending} loadingText="Adding...">
            <Plus size={18} strokeWidth={2} aria-hidden />
            <span>Add questionnaire</span>
          </Button>
        </div>
      </form>
    </Card>
  );
}
