"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface NavItem {
  name: string
  url?: string
  icon: LucideIcon
  onClick?: () => void
}

interface NavBarProps {
  items: NavItem[]
  activeTab?: string
  className?: string
}

export function NavBar({ items, activeTab, className }: NavBarProps) {
  const [currentTab, setCurrentTab] = useState(activeTab || items[0].name)

  useEffect(() => {
    if (activeTab) setCurrentTab(activeTab)
  }, [activeTab])



  return (
    <div
      className={cn(
        "flex justify-center w-full",
        className,
      )}
    >
      <div
        className="flex items-center gap-1 border backdrop-blur-lg py-1 px-1 rounded-full shadow-lg"
        style={{
          backgroundColor: "rgba(255,255,255,0.6)",
          borderColor: "#e5e7eb",
        }}
      >
        {items.map((item) => {
          const Icon = item.icon
          const isActive = currentTab === item.name

          return (
            <button
              key={item.name}
              type="button"
              onClick={() => {
                setCurrentTab(item.name)
                item.onClick?.()
              }}
              className={cn(
                "relative cursor-pointer text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-full transition-colors whitespace-nowrap",
              )}
              style={{
                color: isActive ? "#fff" : "#9ca3af",
                backgroundColor: isActive ? "#111" : "transparent",
                boxShadow: isActive ? "0 4px 6px -1px rgba(0,0,0,0.1)" : "none",
              }}
            >
              <span className="hidden md:inline">{item.name}</span>
              <span className="md:hidden">
                <Icon size={18} strokeWidth={2.5} />
              </span>
              {isActive && (
                <motion.div
                  layoutId="panel-tab-lamp"
                  className="absolute inset-0 w-full rounded-full -z-10"
                  style={{ backgroundColor: "rgba(17,17,17,0.05)" }}
                  initial={false}
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 30,
                  }}
                >
                  <div
                    className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-t-full"
                    style={{ backgroundColor: "#111" }}
                  >
                    <div
                      className="absolute w-12 h-6 rounded-full blur-md -top-2 -left-2"
                      style={{ backgroundColor: "rgba(17,17,17,0.2)" }}
                    />
                    <div
                      className="absolute w-8 h-6 rounded-full blur-md -top-1"
                      style={{ backgroundColor: "rgba(17,17,17,0.2)" }}
                    />
                    <div
                      className="absolute w-4 h-4 rounded-full blur-sm top-0 left-2"
                      style={{ backgroundColor: "rgba(17,17,17,0.2)" }}
                    />
                  </div>
                </motion.div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
