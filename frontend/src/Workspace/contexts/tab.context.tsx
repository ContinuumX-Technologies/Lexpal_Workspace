'use client';

import React from "react"

import  { createContext, useContext, useState, useMemo } from "react";

import { useParams } from 'react-router-dom';

export type TabType =
  | "law_search"
  | "judgement_search"
  | "judgement_analyzer"
  | "draft_space"
  ;

type tabContextType={
    activeTab: TabType,
    setActiveTab:(tab:TabType)=>void,
    isLeftPanelOpen: boolean,
    setIsLeftPanelOpen:(open:boolean)=>void
};


//ctx creation
const tabContext= createContext<tabContextType|null>(null);


//pvdr component
export const TabContextPvdr=({children}:{children:React.ReactNode})=>{
    const { caseId } = useParams<{ caseId: string }>();
    const [activeTab, setActiveTab]=useState<TabType>(caseId ? "judgement_search" : "law_search");
    const [isLeftPanelOpen, setIsLeftPanelOpen]=useState<boolean>(false);


    const tabContextValue= useMemo<tabContextType>(()=>(
        {
         activeTab, 
         setActiveTab, 
         isLeftPanelOpen, 
         setIsLeftPanelOpen

        }),
        [
            activeTab,
            setActiveTab,
            isLeftPanelOpen,
            setIsLeftPanelOpen
        ]);


    // plain js shorthand activeTab: activeTab
    return( <tabContext.Provider value={tabContextValue}>
        {children}
     </tabContext.Provider>); 
};

//consumer hook
export const useTabCtx=()=>{
    const ctx= useContext(tabContext);

    if(!ctx)throw new Error("tab ctx consumer error");

    return ctx;
}
