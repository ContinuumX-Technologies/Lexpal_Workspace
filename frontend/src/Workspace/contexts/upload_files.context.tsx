import {
    createContext,
    useContext,
    useEffect,
    useState,
} from "react";
import Dexie from "dexie";




export const MAX_UPLOAD_SIZE_BYTES =
    25 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const ALLOWED_UPLOAD_EXTENSIONS = [
    ".pdf",
    ".docx",
] as const;





// local-storage DB setup
const db = new Dexie("lexpal");

db.version(1).stores({
    uploaded_files: "id",
});





// Helper functions
const getErrorMessage = (err: unknown) =>{
    return err instanceof Error
        ? err.message
        : "Unknown error";
}


const inferMimeTypeFromName = (
    fileName: string
): string => {
    const normalizedName = fileName.toLowerCase();

    if (normalizedName.endsWith(".pdf")) {
        return "application/pdf";
    }

    if (normalizedName.endsWith(".docx")) {
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }

    return "";
};


export const isAllowedUploadFile = (
    file: File
) => {
    const normalizedName = file.name.toLowerCase();

    const hasAllowedExtension =
        ALLOWED_UPLOAD_EXTENSIONS.some(
            (ext) =>
                normalizedName.endsWith(ext)
        );

    const hasAllowedMime =
        ALLOWED_UPLOAD_MIME_TYPES.includes(
            file.type as
                | "application/pdf"
                | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );

    return hasAllowedExtension || hasAllowedMime;
};










export type UploadedFile = {
    id: string;
    name: string;
    type: string;
    size: number;
    used_as_attachment: boolean;
    createdAt: string;
    file: Blob;
};


export type UploadedFileMeta = {
    id: string;
    name: string;
    type: string;
    size: number;
    used_as_attachment: boolean;
    createdAt: string;
};



export type UploadFileResult =
    | {
          success: true;
          file: UploadedFileMeta;
      }
    | {
          success: false;
          error: string;
      };



type UploadedFilesContextType = {
    uploaded_files: UploadedFileMeta[];

    uploadFile: (
        file: File
    ) => Promise<UploadFileResult>;

    getFile: (
        id: string
    ) => Promise<UploadedFile | undefined>;

    removeFile: (id: string) => Promise<void>;

    markAsUsed: (id: string) => Promise<void>;

    refreshUploadedFiles: () => Promise<void>;
};







const UploadedFilesContext =
    createContext<UploadedFilesContextType | null>(
        null
    );





//Context provider component
export function UploadedFilesProvider({
    children,
}: {
    children: React.ReactNode;
}) {


    const [uploaded_files, setUploadedFiles] = useState<UploadedFileMeta[]>([]);




    const refreshUploadedFiles = async () => {
        try {
            const files = await db
                .table("uploaded_files")
                .toArray();

            const metadataOnly = files.map(
                (file: any) => ({
                    id: file.id,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    used_as_attachment:
                        file.used_as_attachment,
                    createdAt: file.createdAt,
                })
            );

            setUploadedFiles(metadataOnly);
        } catch (err) {
            console.log(
                "error refreshing uploaded files :",
                err
            );
        }
    };








    const uploadFile = async (
        file: File
    ): Promise<UploadFileResult> => {
        if (!isAllowedUploadFile(file)) {
            return {
                success: false,
                error:
                    "Only PDF and DOCX files are allowed.",
            };
        }

        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
            return {
                success: false,
                error:
                    "File is too large. Maximum allowed size is 25 MB.",
            };
        }

        try {
            const id = crypto.randomUUID();

            const normalizedType =
                file.type ||
                inferMimeTypeFromName(file.name);

            const fileDoc: UploadedFile = {
                id,
                name: file.name,
                type: normalizedType,
                size: file.size,
                used_as_attachment: false,
                createdAt:
                    new Date().toISOString(),
                file,
            };

            await db
                .table("uploaded_files")
                .put(fileDoc);

            const metadata: UploadedFileMeta = {
                id,
                name: file.name,
                type: normalizedType,
                size: file.size,
                used_as_attachment: false,
                createdAt: fileDoc.createdAt,
            };

            setUploadedFiles((prev) => [
                ...prev,
                metadata,
            ]);

            return {
                success: true,
                file: metadata,
            };
        } catch (err) {
            console.log("upload file error:", err);

            return {
                success: false,
                error: getErrorMessage(err),
            };
        }
    };








    const getFile = async (
        id: string
    ): Promise<UploadedFile | undefined> => {
        try {
            const file = await db
                .table("uploaded_files")
                .get(id);

            return file as UploadedFile;
        } catch (err) {
            console.log("get file error:", err);

            return undefined;
        }
    };










    const removeFile = async (id: string) => {
        try {
            await db
                .table("uploaded_files")
                .delete(id);

            setUploadedFiles((prev) =>
                prev.filter((f) => f.id !== id)
            );
        } catch (err) {
            console.log("remove file error:", err);
        }
    };











    const markAsUsed = async (id: string) => {
        try {
            const file: any = await db
                .table("uploaded_files")
                .get(id);

            if (!file) return;

            file.used_as_attachment = true;

            await db
                .table("uploaded_files")
                .put(file);

            setUploadedFiles((prev) =>
                prev.map((f) =>
                    f.id === id
                        ? {
                              ...f,
                              used_as_attachment: true,
                          }
                        : f
                )
            );
        } catch (err) {
            console.log(
                "mark as used error:",
                err
            );
        }
    };





    useEffect(() => {
        refreshUploadedFiles();
    }, []);






    return (
        <UploadedFilesContext.Provider
            value={{
                uploaded_files,
                uploadFile,
                getFile,
                removeFile,
                markAsUsed,
                refreshUploadedFiles,
            }}
        >
            {children}
        </UploadedFilesContext.Provider>
    );

}








//Context consumer fucntion
export function useUploadedFiles() {
    const context = useContext(
        UploadedFilesContext
    );

    if (!context) {
        throw new Error(
            "useUploadedFiles must be used inside UploadedFilesProvider"
        );
    }

    return context;
}
