import { Dispatch, Store, AnyAction, Middleware, createStore, applyMiddleware } from "redux";
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
  private initialized = false;

  constructor(
    private readonly init: (flags: flags) => readonly [model, Cmd<msg>],
    private readonly subscriptions: (model: model) => Sub<msg>,
    private readonly update: (model: model, msg: msg) => readonly [model, Cmd<msg>],
    apiSpec: api,
  ) {
    const ports = {} as any;

    const middleware: Middleware<{}, model> = ({ dispatch, getState }) => next => action => {
      if (!this.initialized) {
        throw new Error("application.run() must be called before application.store.dispatch()");
      }

      const [model, cmd] =
        action.type === "@@SetModel"
          ? [action.model, Cmd.None<msg>()]
          : this.update(getState(), action);

      this.handleUpdate(model, cmd, next);
    };

    this.store = createStore<model, msg, {}, {}>(
      (_, action: AnyAction) => (action.type === "@@SetModel" ? action.model : notStarted),
      applyMiddleware(middleware),
    );

    for (const port in apiSpec) {
      if (apiSpec.hasOwnProperty(port)) {
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
    }

    this.writablePorts = ports;
  }

  public run(flags: flags) {
    const [model, cmd] = this.init(flags);
    this.initialized = true;
    this.handleUpdate(model, cmd, this.store.dispatch);
  }

  private handleUpdate(model: model, cmd: Cmd<msg>, dispatch: Dispatch<any>) {
    dispatch({ type: "@@SetModel", model });
    this.subs = this.subscriptions(model);
    this.handleCmd(cmd, this.store.dispatch);
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
