import React from "react";

function renderTitle(title) {
  if (!title || typeof title !== "string") return title;
  const trimmed = title.trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace === -1) {
    return <span className="text-heading-gradient">{trimmed}</span>;
  }
  return (
    <>
      {trimmed.slice(0, lastSpace)}{" "}
      <span className="text-heading-gradient">{trimmed.slice(lastSpace + 1)}</span>
    </>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-col gap-3 px-8 pt-7 pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-sans text-[24px] font-extrabold tracking-tight text-[#1f2544] dark:text-white">
          {renderTitle(title)}
        </h1>
        {description && <p className="mt-1 text-[13.5px] text-[#6b7194] dark:text-[#8F97A6]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export default PageHeader;
