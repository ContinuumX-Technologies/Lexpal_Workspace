// routes/Workspace.tsx
// import { useParams } from 'react-router-dom'
import { TabContextPvdr } from './contexts/tab.context'

import WorkspaceLayout from './layout/WorkspaceLayout'

export default function Workspace() {
//   const { caseId } = useParams<{ caseId: string }>()

//   if (!caseId) return null

  return (
      <TabContextPvdr>
        <WorkspaceLayout />
        </TabContextPvdr>
     
   
  );
}