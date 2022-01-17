import {
    PreventableBaklavaEvent,
    BaklavaEvent,
    SequentialHook,
    IBaklavaEventEmitter,
    IBaklavaTapable,
    createProxy,
} from "@baklavajs/events";
import type { Connection } from "./connection";
import type { IAddNodeTypeEventData, IRegisterNodeTypeOptions } from "./eventDataTypes";
import { Graph, IGraphState } from "./graph";
import { createGraphNodeType, getGraphNodeTypeString } from "./graphNode";
import { GraphTemplate, IGraphTemplateState } from "./graphTemplate";
import type { AbstractNode, AbstractNodeConstructor } from "./node";

export interface IEditorState extends Record<string, any> {
    graph: IGraphState;
    graphTemplates: IGraphTemplateState[];
}

export interface INodeTypeInformation extends Required<IRegisterNodeTypeOptions> {
    type: AbstractNodeConstructor;
}

/** The main model class for BaklavaJS */
export class Editor implements IBaklavaEventEmitter, IBaklavaTapable {
    public events = {
        loaded: new BaklavaEvent<void, Editor>(this),
        beforeRegisterNodeType: new PreventableBaklavaEvent<IAddNodeTypeEventData, Editor>(this),
        registerNodeType: new BaklavaEvent<IAddNodeTypeEventData, Editor>(this),
        beforeUnregisterNodeType: new PreventableBaklavaEvent<string, Editor>(this),
        unregisterNodeType: new BaklavaEvent<string, Editor>(this),
        beforeAddGraphTemplate: new PreventableBaklavaEvent<GraphTemplate, Editor>(this),
        addGraphTemplate: new BaklavaEvent<GraphTemplate, Editor>(this),
        beforeRemoveGraphTemplate: new PreventableBaklavaEvent<GraphTemplate, Editor>(this),
        removeGraphTemplate: new BaklavaEvent<GraphTemplate, Editor>(this),
        registerGraph: new BaklavaEvent<Graph, Editor>(this),
        unregisterGraph: new BaklavaEvent<Graph, Editor>(this),
    };

    public hooks = {
        save: new SequentialHook<IEditorState, Editor>(this),
        load: new SequentialHook<IEditorState, Editor>(this),
    };

    public graphTemplateEvents = createProxy<GraphTemplate["events"]>();
    public graphTemplateHooks = createProxy<GraphTemplate["hooks"]>();
    public graphEvents = createProxy<Graph["events"]>();
    public graphHooks = createProxy<Graph["hooks"]>();
    public nodeEvents = createProxy<AbstractNode["events"]>();
    public nodeHooks = createProxy<AbstractNode["hooks"]>();
    public connectionEvents = createProxy<Connection["events"]>();

    private _graphs = new Set<Graph>();
    private _nodeTypes: Map<string, INodeTypeInformation> = new Map();
    private _graph = new Graph(this);
    private _graphTemplates: GraphTemplate[] = [];

    /** List of all registered node types */
    public get nodeTypes(): ReadonlyMap<string, INodeTypeInformation> {
        return this._nodeTypes;
    }

    /** The root graph */
    public get graph(): Graph {
        return this._graph;
    }

    /** List of all registered graph templates (subgraphs) */
    public get graphTemplates(): ReadonlyArray<GraphTemplate> {
        return this._graphTemplates;
    }

    /** Set of all graphs in the editor, including subgraphs */
    public get graphs(): ReadonlySet<Graph> {
        return this._graphs;
    }

    /**
     * Register a new node type
     * @param type Actual type / constructor of the node
     * @param options Optionally specify a title and/or a category for this node
     */
    public registerNodeType(type: AbstractNodeConstructor, options?: IRegisterNodeTypeOptions): void {
        if (this.events.beforeRegisterNodeType.emit({ type, options })) {
            return;
        }
        const nodeInstance = new type();
        this._nodeTypes.set(nodeInstance.type, {
            type,
            category: options?.category ?? "default",
            title: options?.title ?? nodeInstance.title,
        });
        this.events.registerNodeType.emit({ type, options });
    }

    /**
     * Unregister an existing node type. Will also remove all the nodes of this type in all graphs.
     * @param type String type or node constructor, from which the type will be detected
     */
    public unregisterNodeType(type: AbstractNodeConstructor | string): void {
        const stringType = typeof type === "string" ? type : new type().type;
        if (this.nodeTypes.has(stringType)) {
            if (this.events.beforeUnregisterNodeType.emit(stringType)) {
                return;
            }

            // remove all nodes of this type in all graphs
            for (const g of [this.graph, ...this.graphs.values()]) {
                const nodesToRemove = g.nodes.filter((n) => n.type === stringType);
                for (const n of nodesToRemove) {
                    g.removeNode(n);
                }
            }

            this._nodeTypes.delete(stringType);
            this.events.unregisterNodeType.emit(stringType);
        }
    }

    public addGraphTemplate(template: GraphTemplate): void {
        if (this.events.beforeAddGraphTemplate.emit(template)) {
            return;
        }
        this._graphTemplates.push(template);
        this.graphTemplateEvents.addTarget(template.events);
        this.graphTemplateHooks.addTarget(template.hooks);

        const nt = createGraphNodeType(template);
        this.registerNodeType(nt, { category: "Subgraphs", title: template.name });

        this.events.addGraphTemplate.emit(template);
    }

    public removeGraphTemplate(template: GraphTemplate): void {
        if (this.graphTemplates.includes(template)) {
            if (this.events.beforeRemoveGraphTemplate.emit(template)) {
                return;
            }

            this.unregisterNodeType(getGraphNodeTypeString(template));

            this._graphTemplates.splice(this._graphTemplates.indexOf(template), 1);
            this.graphTemplateEvents.removeTarget(template.events);
            this.graphTemplateHooks.removeTarget(template.hooks);
            this.events.removeGraphTemplate.emit(template);
        }
    }

    public registerGraph(graph: Graph) {
        this.graphEvents.addTarget(graph.events);
        this.graphHooks.addTarget(graph.hooks);
        this.nodeEvents.addTarget(graph.nodeEvents);
        this.nodeHooks.addTarget(graph.nodeHooks);
        this.connectionEvents.addTarget(graph.connectionEvents);
        this.events.registerGraph.emit(graph);

        this._graphs.add(graph);
    }

    public unregisterGraph(graph: Graph) {
        this.graphEvents.removeTarget(graph.events);
        this.graphHooks.removeTarget(graph.hooks);
        this.nodeEvents.removeTarget(graph.nodeEvents);
        this.nodeHooks.removeTarget(graph.nodeHooks);
        this.connectionEvents.removeTarget(graph.connectionEvents);
        this.events.unregisterGraph.emit(graph);

        this._graphs.delete(graph);
    }

    /**
     * Load a state
     * @param state State to load
     */
    public load(state: IEditorState): void {
        state = this.hooks.load.execute(state);

        state.graphTemplates.forEach((tState) => {
            const template = new GraphTemplate(tState, this);
            this.addGraphTemplate(template);
        });

        this._graph.load(state.graph);

        this.events.loaded.emit();
    }

    /**
     * Save a state
     * @returns Current state
     */
    public save(): IEditorState {
        const state: IEditorState = {
            graph: this.graph.save(),
            graphTemplates: this.graphTemplates.map((t) => t.save()),
        };
        return this.hooks.save.execute(state);
    }
}