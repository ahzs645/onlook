import { WebSearchTool } from '@onlook/ai';
import type { WebSearchResult } from '@onlook/models';
import type { ToolUIPart } from 'ai';
import { observer } from 'mobx-react-lite';
import { type z } from 'zod';
import { SearchSourcesDisplay } from '../../code-display/search-sources-display';
import { ToolArtifactCard } from './tool-artifact-card';
import { resolveToolArtifact } from './tool-artifacts';
import { ToolCallSimple } from './tool-call-simple';

const ToolCallDisplayComponent = ({
    messageId,
    toolPart,
    isStream,
    applied
}: {
    messageId: string,
    toolPart: ToolUIPart,
    isStream: boolean,
    applied: boolean
}) => {
    const toolName = toolPart.type.split('-')[1] ?? '';

    if (isStream || (toolPart.state !== 'output-available' && toolPart.state !== 'input-available')) {
        return (
            <ToolCallSimple
                toolPart={toolPart}
                key={toolPart.toolCallId}
                loading={true}
            />
        );
    }

    const artifact = resolveToolArtifact({
        toolName,
        toolInput: toolPart.input,
        toolOutput: toolPart.output,
    });
    if (artifact) {
        return (
            <ToolArtifactCard
                artifact={artifact}
                messageId={messageId}
                applied={applied}
                isStream={isStream}
            />
        );
    }

    if (toolName === WebSearchTool.toolName && toolPart.state === 'output-available') {
        const searchResult: WebSearchResult | null = toolPart.output as WebSearchResult | null;
        const args = toolPart.input as z.infer<typeof WebSearchTool.parameters>;
        if (args?.query && searchResult?.result && searchResult.result.length > 0) {
            return (
                <SearchSourcesDisplay
                    query={String(args.query)}
                    results={Array.isArray(searchResult.result) ? (searchResult.result as unknown[]).map((result: unknown) => ({
                        title: String((result as { title?: string; url?: string }).title ?? (result as { url?: string }).url ?? ''),
                        url: String((result as { url?: string }).url ?? '')
                    })) : []}
                />
            );
        }
    }

    // if (toolName === TodoWriteTool.toolName) {
    //     const args = toolPart.input as z.infer<typeof TodoWriteTool.parameters> | null;
    //     const todos = args?.todos;
    //     if (!todos || todos.length === 0) {
    //         return (
    //             <ToolCallSimple
    //                 toolPart={toolPart}
    //                 key={toolPart.toolCallId}
    //                 loading={loading}
    //             />
    //         );
    //     }
    //     return (
    //         <div>
    //             {todos.map((todo) => (
    //                 <div className="flex items-center gap-2 text-sm" key={todo.content}>
    //                     <div className="flex items-center justify-center w-4 h-4 min-w-4">
    //                         {
    //                             todo.status === 'completed' ?
    //                                 <Icons.SquareCheck className="w-4 h-4" /> :
    //                                 <Icons.Square className="w-4 h-4" />
    //                         }
    //                     </div>
    //                     <p className={cn(
    //                         todo.status === 'completed' ? 'line-through text-green-500' : '',
    //                         todo.status === 'in_progress' ? 'text-yellow-500' : '',
    //                         todo.status === 'pending' ? 'text-gray-500' : '',
    //                     )}>{todo.content}</p>
    //                 </div>
    //             ))}
    //         </div>
    //     );
    // }

    return (
        <ToolCallSimple
            toolPart={toolPart}
            key={toolPart.toolCallId}
        />
    );
};

export const ToolCallDisplay = observer(ToolCallDisplayComponent);
