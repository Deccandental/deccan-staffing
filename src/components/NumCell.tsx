"use client";

import { useState, useEffect } from "react";

/**
 * A numeric table cell that keeps exactly what you type.
 *
 * The old cells rebuilt their text from a number on every keystroke, which
 * swallowed a decimal point ("250." became "250"), made it impossible to clear
 * the box, and left stray zeros. This one holds its own text, hands the parent
 * a number as soon as the text is a valid one (empty counts as 0), and shows a
 * faint 0 placeholder when empty so the numbers actually entered stand out.
 */
export default function NumCell({ value, onChange, className, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number; onChange: (n: number) => void;
}) {
  const [text, setText] = useState(value ? String(value) : "");

  // Follow outside changes (a reload, another row's save) but never fight typing.
  useEffect(() => {
    if (Number(text === "" ? 0 : text) !== value) setText(value ? String(value) : "");
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input {...rest} type="number" step="any" inputMode="decimal" placeholder="0" value={text} className={className}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.value === "" ? 0 : Number(e.target.value);
        if (!isNaN(n)) onChange(n);
      }} />
  );
}
