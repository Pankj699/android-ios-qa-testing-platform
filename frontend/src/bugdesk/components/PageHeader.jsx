import React from "react";

export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-col gap-3 px-8 pt-7 pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-display text-[23px] font-bold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] text-[#8F97A6]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export default PageHeader;
