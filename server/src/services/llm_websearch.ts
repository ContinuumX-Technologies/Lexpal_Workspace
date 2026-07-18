import openaiClient from "../infra/openai.client"


export type WebResearch = {
    content: string;
    sources: {


        title: string;

        url: string;

    }[];


};



export const performAIWebResearch = async (prompt: string): Promise<WebResearch> => {
    try {
        const response = await openaiClient.responses.create({
            store: false,
            model: "gpt-5-mini",
            reasoning: { effort: "high" },
            tools: [
                {
                    type: "web_search_preview",
                    search_context_size: "medium",
                }
            ],

            input: prompt




        })

        
        
        const sources: WebResearch["sources"] = [];

        for (const outputItem of response.output) {

            if (outputItem.type !== "message") continue;

            for (const contentItem of outputItem.content) {

                if (contentItem.type !== "output_text") continue;

                for (const annotation of contentItem.annotations) {

                    if (annotation.type !== "url_citation") continue;

                    sources.push({



                        title: annotation.title,

                        url: annotation.url,

                    });

                }

            }

        }




        return {

            content: response.output_text,

            sources,

        };


    } catch (error) {
        if(error instanceof Error){
            throw Error(`ai web-search error: ${error.message}`);
        }
        throw Error("ai web-search error");
    }
}