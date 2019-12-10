import {
  Dispatch,
  Store,
  AnyAction,
  Middleware,
  createStore,
  applyMiddleware,
  compose,
  StoreEnhancer,
  Reducer,
  Action,
  DeepPartial,
} from "redux";
import {
  ApiSpec,
  Cmd,
  Sub,
  CmdPort,
  SubPort,
  RunCmd,
  Ports,
  CmdSpec,
  SubSpec,
  ListenSub,
} from "./ports";

class OutPort<a, msg extends AnyAction, b> implements CmdPort<a, b> {
  private readonly subscribers: Array<(data: a, next: (response: b) => void) => void> = [];

  subscribe(handler: (data: a, next: (response: b) => void) => void): void {
    this.subscribers.push(handler);
  }

  public send(cmd: RunCmd<msg>, dispatch: Dispatch<msg>) {
    for (const subscriber of this.subscribers) {
      subscriber(cmd.data, response => dispatch(cmd.handleResponse(response)));
    }
  }
}

class InPort<a, msg extends AnyAction> implements SubPort<a> {
  constructor(private readonly handler: (data: a) => void) {}

  send(data: a): void {
    this.handler(data);
  }
}

type WritablePorts<spec extends ApiSpec, msg extends AnyAction> = {
  [port in keyof spec]: spec[port] extends CmdSpec<infer a, infer b>
    ? OutPort<a, msg, b>
    : spec[port] extends SubSpec<infer a>
    ? InPort<a, msg>
    : never;
};

export const notStarted = Symbol("Unique symbol for NotStarted");

export class Application<msg extends AnyAction, model, flags = {}, api extends ApiSpec = {}> {
  public get ports(): Ports<api> {
    return this.writablePorts;
  }

  private readonly writablePorts: WritablePorts<api, msg>;
  public readonly store: Store<model, msg>;
  private subs: Sub<msg> = Sub.None();

  constructor(
    private readonly init: (flags: flags) => readonly [model, Cmd<msg>],
    private readonly subscriptions: (model: model) => Sub<msg>,
    private readonly update: (model: model, msg: msg) => readonly [model, Cmd<msg>],
    apiSpec: api,
    enhancer?: StoreEnhancer<{}, {}>,
  ) {
    const ports = {} as any;

    const appEnhancer: StoreEnhancer<{}, {}> = innerCreator => <S, A extends Action>(
      reducer: Reducer<S, A>,
      preloadedState?: DeepPartial<S>,
    ) => {
      let cmdQueue = [] as Cmd<msg>[];

      const runReducer = (r: Reducer<S, A>) => {
        return (model: S | undefined, msg: A) => {
          if (msg.type === "@@ReduxPortsInit") {
            cmdQueue.push((msg as any).cmd);
            this.subs = this.subscriptions((msg as any).model);
            return (msg as any).model;
          } else if (msg.type.startsWith("@@")) {
            return model ?? notStarted;
          } else if ((model as any) === notStarted) {
            throw new Error("application.run() must be called before application.store.dispatch()");
          } else {
            const [newModel, cmd] = r(model, msg) as any;
            cmdQueue.push(cmd);
            this.subs = this.subscriptions(newModel);
            return newModel;
          }
        };
      };

      const innerStore = innerCreator<S, A>(runReducer(reducer), preloadedState);

      const dispatch = (action: A) => {
        const result = innerStore.dispatch(action);
        const cmdsToRun = cmdQueue;
        cmdQueue = [];
        this.handleCmd(Cmd.Batch(...cmdsToRun), dispatch as any);
        return result;
      };

      function replaceReducer(reducer: Reducer<S, A>) {
        return innerStore.replaceReducer(runReducer(reducer));
      }

      return {
        ...innerStore,
        dispatch,
        replaceReducer,
      } as Store<S, A>;
    };

    this.store = createStore<model, msg, {}, {}>(
      this.update as any,
      enhancer ? compose(appEnhancer, enhancer) : appEnhancer,
    );

    for (const port in apiSpec) {
      const portSpec = apiSpec[port];
      ports[port] =
        portSpec.type === 0
          ? new OutPort()
          : new InPort(data => {
              const subs = this.flattenSubs(this.subs);
              for (const sub of subs) {
                if (sub.port === port) {
                  this.store.dispatch(sub.handler(data));
                }
              }
            });
    }

    this.writablePorts = ports;
  }

  public run(flags: flags) {
    const [model, cmd] = this.init(flags);
    this.store.dispatch({ type: "@@ReduxPortsInit", model, cmd } as any);
  }

  private handleCmd(cmd: Cmd<msg>, dispatch: Dispatch<msg>) {
    switch (cmd.tag) {
      case "Batch":
        for (const c of cmd.cmds) {
          this.handleCmd(c, dispatch);
        }
        return;

      case "Msg":
        dispatch(cmd.msg);
        break;

      case "Run":
        this.writablePorts[cmd.run.port].send(cmd.run, dispatch);
        break;
    }
  }

  private flattenSubs(sub: Sub<msg>): ListenSub<msg>[] {
    switch (sub.tag) {
      case "None":
        return [];

      case "Batch":
        return ([] as ListenSub<msg>[]).concat(...sub.subs.map(this.flattenSubs));

      case "Listen":
        return [sub.listen];
    }
  }
}
