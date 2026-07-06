// routes/Workspace.tsx
// import { useParams } from 'react-router-dom'
import { TabContextPvdr } from './contexts/tab.context'
import { JDSearchProvider } from './workspace_tabs/judgement_search/JDSearch.context'
import { UploadedFilesProvider } from './contexts/upload_files.context'

import WorkspaceLayout from './layout/WorkspaceLayout'

export default function Workspace() {
//   const { caseId } = useParams<{ caseId: string }>()

//   if (!caseId) return null

  return (
      <TabContextPvdr>
        <UploadedFilesProvider>
          <JDSearchProvider>
            <WorkspaceLayout />
          </JDSearchProvider>
        </UploadedFilesProvider>
      </TabContextPvdr>
  );
}
