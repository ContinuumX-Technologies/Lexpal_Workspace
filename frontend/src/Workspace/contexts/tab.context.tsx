'use client';

import React from "react"

import  { createContext, useContext, useState } from "react";

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
    const [activeTab, setActiveTab]=useState<TabType>("law_search");
    const [isLeftPanelOpen, setIsLeftPanelOpen]=useState<boolean>(false);

    // plain js shorthand activeTab: activeTab
    return( <tabContext.Provider value={{activeTab, setActiveTab, isLeftPanelOpen, setIsLeftPanelOpen}}>
        {children}
     </tabContext.Provider>); 
};

//consumer hook
export const useTabCtx=()=>{
    const ctx= useContext(tabContext);

    if(!ctx)throw new Error("tab ctx consumer error");

    return ctx;
}
