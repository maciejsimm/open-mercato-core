"use client"

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownList,
  DropdownTrigger,
} from '@open-mercato/ui/primitives/dropdown'
import { SCHEDULE_FORMATS, type ScheduleFormat } from '../../../../data/validators'
import { formatLabel } from './cadence-text'

export type FormatsMultiSelectProps = {
  id: string
  value: ScheduleFormat[]
  disabled?: boolean
  onChange: (next: ScheduleFormat[]) => void
}

export function FormatsMultiSelect({ id, value, disabled, onChange }: FormatsMultiSelectProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const selected = SCHEDULE_FORMATS.filter((format) => value.includes(format))
  const triggerLabel = selected.length
    ? selected.map((format) => formatLabel(format, t)).join(', ')
    : t('reports.schedules.formats.placeholder', 'Select formats')

  const toggle = (format: ScheduleFormat) => {
    const next = value.includes(format) ? value.filter((entry) => entry !== format) : [...value, format]
    onChange(SCHEDULE_FORMATS.filter((entry) => next.includes(entry)))
  }

  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          data-crud-focus-target=""
          data-testid="reports-schedule-formats-trigger"
        >
          <span className={selected.length ? 'truncate text-foreground' : 'truncate text-muted-foreground'}>
            {triggerLabel}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownTrigger>
      <DropdownContent
        className="w-72"
        aria-label={t('reports.schedules.new.fields.formats', 'Formats')}
        commandProps={{ label: t('reports.schedules.new.fields.formats', 'Formats') }}
      >
        <DropdownList aria-multiselectable="true">
          {SCHEDULE_FORMATS.map((format) => (
            <DropdownItem
              key={format}
              value={format}
              checked={value.includes(format)}
              aria-checked={value.includes(format)}
              onSelect={() => toggle(format)}
              data-testid={`reports-schedule-format-${format}`}
            >
              {formatLabel(format, t)}
            </DropdownItem>
          ))}
        </DropdownList>
      </DropdownContent>
    </Dropdown>
  )
}
