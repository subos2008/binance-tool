You likely want to run the following commands to get connected to the internal AMQP:

```bash
AMQP_NAMESPACE=persistent-state
export POD_NAME=$(kubectl get pods --namespace $AMQP_NAMESPACE -l "app=rabbitmq-ha" -o jsonpath="{.items[0].metadata.name}")
kubectl port-forward $POD_NAME --namespace $AMQP_NAMESPACE 5672:5672 15672:15672
```
