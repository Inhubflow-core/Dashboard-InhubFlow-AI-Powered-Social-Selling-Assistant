"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Smartphone, Mic } from "lucide-react";

export default function SidebarWidget() {
  const t = useTranslations("sidebar.widget");

  return (
    <div className="pb-16 space-y-3 px-1">
      {/* InhubBot App CTA */}
      <div className="rounded-xl bg-gradient-to-br from-[#0099ff]/10 via-[#0099ff]/5 to-transparent p-3.5 border border-[#0099ff]/20 text-center">
        <div className="flex items-center justify-center w-8 h-8 mx-auto mb-2 rounded-lg bg-[#0099ff]/20 text-[#0099ff]">
          <Smartphone className="w-4 h-4" />
        </div>
        <h4 className="text-xs font-bold text-gray-900 dark:text-white flex items-center justify-center gap-1">
          InhubBot App
          <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-[#0099ff]/20 text-[#0099ff]">
            Voz
          </span>
        </h4>
        <p className="mt-1 mb-2.5 text-[11px] text-gray-500 dark:text-slate-400 leading-tight">
          Controla tu LinkedIn desde el móvil usando comandos de voz
        </p>
        <Link
          href="/bot"
          className="flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-white rounded-lg bg-[#0099ff] hover:bg-[#0088e6] transition shadow-xs"
        >
          <Mic className="w-3.5 h-3.5" />
          <span>Abrir InhubBot</span>
        </Link>
      </div>
    </div>
  );
}
