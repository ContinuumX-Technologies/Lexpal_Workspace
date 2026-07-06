"use client";

import React, { createContext, useContext, useState, useEffect } from "react";



interface SidebarContextType {
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
    setSidebarOpen: (open: boolean) => void;
    sidebarWidth: number;
    setSidebarWidth: (width: number) => void;

   
   
    currentConvoId: string | null;
    setCurrentConvoId: (id: string | null) => void;
}



const SidebarContext = createContext<SidebarContextType | undefined>(undefined);



export function SidebarProvider({ children }: { children: React.ReactNode }) {
    // Default to open and 260px (ChatGPT standard)
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(260);


     const [currentConvoId, setCurrentConvoId] = useState<string | null>("new");


    // Optional: Persist to localStorage
    useEffect(() => {
        const savedOpen = localStorage.getItem("lexpal_sidebar_open");
        const savedWidth = localStorage.getItem("lexpal_sidebar_width");

        const isMobile = window.innerWidth < 768;

        if (savedOpen !== null) {
            setIsSidebarOpen(isMobile ? false : savedOpen === "true");
        } else {
            setIsSidebarOpen(!isMobile); // Default open on desktop, closed on mobile
        }

        if (savedWidth) setSidebarWidth(parseInt(savedWidth));
    }, []);

    useEffect(() => {
        localStorage.setItem("lexpal_sidebar_open", String(isSidebarOpen));
        localStorage.setItem("lexpal_sidebar_width", String(sidebarWidth));
    }, [isSidebarOpen, sidebarWidth]);

    const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);
    const setSidebarOpen = (open: boolean) => setIsSidebarOpen(open);

    return (
        <SidebarContext.Provider
            value={{
                isSidebarOpen,
                toggleSidebar,
                setSidebarOpen,
                
                sidebarWidth,
                setSidebarWidth,

                currentConvoId,
                setCurrentConvoId,
            }}
        >
            {children}
        </SidebarContext.Provider>
    );
}

export function useSidebar() {
    const context = useContext(SidebarContext);
    if (context === undefined) {
        throw new Error("useSidebar must be used within a SidebarProvider");
    }
    return context;
}
