"use client";

import  { useRef, useState, useCallback, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import { SidebarProvider, useSidebar } from "./context/SidebarContext";
import { LawSearchAttachmentsProvider } from "./context/attachments.context";

import styles from "./LawSearch.module.css"; // We'll create this CSS next
import MainChatSection from "./MainChatSection";






function SidebarWrapper() {
    const { isSidebarOpen, sidebarWidth, setSidebarWidth } = useSidebar();
    const [isResizing, setIsResizing] = useState(false);
    const sidebarRef = useRef<HTMLDivElement>(null);

    const startResizing = useCallback(() => {
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback(
        (mouseMoveEvent: MouseEvent) => {
            if (isResizing) {
                const newWidth = mouseMoveEvent.clientX;
                if (newWidth >= 200 && newWidth <= 480) { // Min/Max constraints
                    setSidebarWidth(newWidth);
                }
            }
        },
        [isResizing, setSidebarWidth]
    );

    useEffect(() => {
        window.addEventListener("mousemove", resize);
        window.addEventListener("mouseup", stopResizing);
        return () => {
            window.removeEventListener("mousemove", resize);
            window.removeEventListener("mouseup", stopResizing);
        };
    }, [resize, stopResizing]);



    
    // const handleNewChat = () => {
    //     router.push("/Lex-AI/new");
    // };


    return (

        <div
        className={styles.sidebarContainer}
        style={{ width: isSidebarOpen ? sidebarWidth : 0, transition: "width 0.3s ease" }}
        ref={sidebarRef}
        >

            <Sidebar  />

            {/* sidebar prop className={styles.sidebarInstance}*/}
            {/* Draggable Handle - Only when Open */}
            {isSidebarOpen && (
                <div className={styles.resizeHandle} onMouseDown={startResizing}>
                    <div className={styles.resizeLine} />
                </div>
            )}

        </div>

    );
}








export default function LawSearch() {
    return (
        <SidebarProvider>
            <LawSearchAttachmentsProvider>


                <div className={styles.layoutRoot}>

                    <SidebarWrapper />

                    <div className={styles.mainContent}>
                        <MainChatSection/>
                    </div>

                </div>


            </LawSearchAttachmentsProvider>
        </SidebarProvider>
    );
}
