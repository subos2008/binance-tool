//+------------------------------------------------------------------+
//|                                        Perfect Trend Line EA.mq5 |
//|                               Copyright © 2022, Koros Jafarzadeh |
//|                   https://www.mql5.com/en/users/koros0111/seller |
//+------------------------------------------------------------------+
#property copyright   "Copyright © 2022, Koros Jafarzadeh"
#property link        "https://www.mql5.com/en/users/koros0111/seller"
#property description "Telegram ID : @ KorosJafarzadeh\n"
#define   VERSION     "1.01"
#property version      VERSION
#define   APP_NAME    "Perfect Trend Line EA v" + VERSION


#define PRINT_1(A)                        Print(#A + " = " + (string)(A))
#define PRINT_2(A, B)                     Print(#A + " = " + (string)(A), " , ", #B + " = " + (string)(B))
#define PRINT_3(A, B, C)                  Print(#A + " = " + (string)(A), " , ", #B + " = " + (string)(B), " , ", #C + " = " + (string)(C))
#define PRINT_4(A, B, C, D)               Print(#A + " = " + (string)(A), " , ", #B + " = " + (string)(B), " , ", #C + " = " + (string)(C), " , ", #D + " = " + (string)(D))
#define PRINT_5(A, B, C, D, E)            Print(#A + " = " + (string)(A), " , ", #B + " = " + (string)(B), " , ", #C + " = " + (string)(C), " , ", #D + " = " + (string)(D), " , ", #E + " = " + (string)(E))
#define PRINT_6(A, B, C, D, E, F)         Print(#A + " = " + (string)(A), " , ", #B + " = " + (string)(B), " , ", #C + " = " + (string)(C), " , ", #D + " = " + (string)(D), " , ", #E + " = " + (string)(E), " , ", #F + " = " + (string)(F))
#define PRINT_7(A, B, C, D, E, F, G)      Print(#A + " = " + (string)(A), " , ", #B + " = " + (string)(B), " , ", #C + " = " + (string)(C), " , ", #D + " = " + (string)(D), " , ", #E + " = " + (string)(E), " , ", #F + " = " + (string)(F), " , ", #G + " = " + (string)(G))
#define PRINT_8(A, B, C, D, E, F, G, H)   Print(#A + " = " + (string)(A), " , ", #B + " = " + (string)(B), " , ", #C + " = " + (string)(C), " , ", #D + " = " + (string)(D), " , ", #E + " = " + (string)(E), " , ", #F + " = " + (string)(F), " , ", #G + " = " + (string)(G), " , ", #H + " = " + (string)(H))
#define COMMENT_1(A)                      Comment(#A + " = " + (string)(A))
#define COMMENT_2(A, B)                   Comment(#A + " = " + (string)(A) + "\n" + #B + " = " + (string)(B))
#define COMMENT_3(A, B, C)                Comment(#A + " = " + (string)(A) + "\n" + #B + " = " + (string)(B) + "\n" + #C + " = " + (string)(C))
#define COMMENT_4(A, B, C, D)             Comment(#A + " = " + (string)(A) + "\n" + #B + " = " + (string)(B) + "\n" + #C + " = " + (string)(C) + "\n" + #D + " = " + (string)(D))
#define COMMENT_5(A, B, C, D, E)          Comment(#A + " = " + (string)(A) + "\n" + #B + " = " + (string)(B) + "\n" + #C + " = " + (string)(C) + "\n" + #D + " = " + (string)(D) + "\n" + #E + " = " + (string)(E))
#define COMMENT_6(A, B, C, D, E, F)       Comment(#A + " = " + (string)(A) + "\n" + #B + " = " + (string)(B) + "\n" + #C + " = " + (string)(C) + "\n" + #D + " = " + (string)(D) + "\n" + #E + " = " + (string)(E) + "\n" + #F + " = " + (string)(F))
#define COMMENT_7(A, B, C, D, E, F, G)    Comment(#A + " = " + (string)(A) + "\n" + #B + " = " + (string)(B) + "\n" + #C + " = " + (string)(C) + "\n" + #D + " = " + (string)(D) + "\n" + #E + " = " + (string)(E) + "\n" + #F + " = " + (string)(F) + "\n" + #G + " = " + (string)(G))
#define COMMENT_8(A, B, C, D, E, F, G, H) Comment(#A + " = " + (string)(A) + "\n" + #B + " = " + (string)(B) + "\n" + #C + " = " + (string)(C) + "\n" + #D + " = " + (string)(D) + "\n" + #E + " = " + (string)(E) + "\n" + #F + " = " + (string)(F) + "\n" + #G + " = " + (string)(G) + "\n" + #H + " = " + (string)(H))
#define BENCH(A) {ulong StartTime = GetMicrosecondCount();A;StartTime = GetMicrosecondCount() - StartTime;PrintFormat("Time[%s] = %.3f ms", #A, StartTime / 1000.0);}
#define ToSTR(A) (#A + " = " + (string)(A))
#define _CS(A) ((!::IsStopped()) && (A))
#define BENCH_A_B(A,B)                                       \
{                                                            \
  ulong MinTime = ULONG_MAX;                                 \
  for (int i = 0; _CS(i < B); i++)                           \
  {                                                          \
    Comment(#A + ": " + (string)i + "/" + #B);               \
    const ulong StartTime=GetMicrosecondCount();             \
    A;                                                       \
    const ulong TmpTime = GetMicrosecondCount() - StartTime; \
    if (TmpTime < MinTime)                                   \
      MinTime = TmpTime;                                     \
  }                                                          \
  Print("Time["+#A+"] = "+(string)MinTime);                  \
}
static bool IsTester = (::MQLInfoInteger(MQL_TESTER) || ::MQLInfoInteger(MQL_OPTIMIZATION) || ::MQLInfoInteger(MQL_VISUAL_MODE) || ::MQLInfoInteger(MQL_FRAME_MODE));

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
class CisNewBar
  {
protected:
   datetime          m_last_time;
   ENUM_TIMEFRAMES   m_timrframe;
   string            m_symbol_name;
public:
                     CisNewBar(void) {};
                    ~CisNewBar(void) {};
   bool              isNewBar();
   void              SetSymbolPeriod(string symbol = "", ENUM_TIMEFRAMES timeframe = PERIOD_CURRENT);
  };
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void CisNewBar::SetSymbolPeriod(string symbol = "", ENUM_TIMEFRAMES timeframe = PERIOD_CURRENT)
  {
   m_symbol_name = symbol == "" ? Symbol() : symbol;
   m_timrframe = timeframe;
  };
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
bool CisNewBar::isNewBar()
  {
   if(iTime(m_symbol_name, m_timrframe, 0) != m_last_time)
     {
      m_last_time = iTime(m_symbol_name, m_timrframe, 0);
      return(true);
     }
   return false;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+

#include <Trade\PositionInfo.mqh>
#include <Trade\Trade.mqh>
#include <Trade\SymbolInfo.mqh>
#include <Trade\AccountInfo.mqh>
#include <Trade\DealInfo.mqh>

//---
CPositionInfo  m_position;                   // object of CPositionInfo class
CTrade         m_trade;                      // object of CTrade class
CSymbolInfo    m_symbol;                     // object of CSymbolInfo class
CAccountInfo   m_account;                    // object of CAccountInfo class
CDealInfo      m_deal;                       // object of CDealInfo class


enum ENUM_BALANCE
  {
   ACCOUNTBALANCE,    // Account Balance
   ACCOUNTEQUITY,     // Account Equity
   ACCOUNTFREEMARGIN, // Account Free Margin
  };
enum ENUM_ON_OFF
  {
   OFF = 0, //Off
   ON  = 1, //On
  };
enum ENUM_YES_NO
  {
   NO  = 0, //No
   YES = 1, //Yes
  };

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
input string          TrendLine_Pro_Setting = "###### Perfect Trend Line Setting ######";                 // ###### Perfect Trend Line Setting ######
input ENUM_TIMEFRAMES TimeFrame             = PERIOD_CURRENT;                                             // TimeFrame
input int             inpFastLength         = 89;                                                         // Fast length
input int             inpSlowLength         = 89;                                                         // Slow length
input bool            Reverse_Pos           = false;                                                      // Open Reverse Positions
input int             StopLoss_Point        = 0;                                                          // StopLoss (Point) (0 Means No)
input int             TakeProfit_Point      = 0;                                                          // TakeProfit (Point) (0 Means No)
input string          TradeBeginTime        = "00:01";                                                    // Open Position Start Time
input string          TradeEndTime          = "23:59";                                                    // Open Position End Time
input int             Slippage              = 30;                                                         // Slippage (Point)
input ulong           MagicNumber           = 54323456;                                                   // Magic Number
input bool            Print_Log             = true;                                                       // Print log
input string          Lot_Setting           = "###### Lot Setting ######";                                // ###### Lot Setting ######
input double          LotSize               = 0.01;                                                       // Lot Size


int Trailing_Stop = 200; // Trailing Stop (Point) (0 Means No)

#define check_buffer(i) (i != 0 && i != EMPTY_VALUE)


#resource "PTL (2).ex5"


struct struct_buffer
  {
   double            arrow[];
                     struct_buffer()
     {
      ArrayInitialize(arrow, 0);
      ArraySetAsSeries(arrow, true);
     }
  };
struct_buffer buffer;
CisNewBar     new_bar;
int           handle = INVALID_HANDLE;


bool     Apply_Protection_by_date = false;
datetime expire_time              = D'2022.04.14 23:46:43';
//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(!m_symbol.Name(Symbol()))
     {
      Print(__FILE__, " ", __FUNCTION__, ", ERROR: CSymbolInfo.Name");
      return(INIT_FAILED);
     }
   m_symbol.RefreshRates();
   m_trade.SetExpertMagicNumber(MagicNumber);
   m_trade.SetMarginMode();
   m_trade.SetTypeFillingBySymbol(m_symbol.Name());
   m_trade.SetDeviationInPoints(Slippage);
//---
   handle = iCustom(m_symbol.Name(), TimeFrame, "::PTL (2).ex5", inpFastLength, inpSlowLength);
   if(handle == INVALID_HANDLE)
     {
      PrintFormat("Failed to create handle of the Perfect Trend Line indicator for the symbol %s/%s, error code %d", m_symbol.Name(), EnumToString(Period()), GetLastError());
      return(INIT_FAILED);
     }
//---
   new_bar.SetSymbolPeriod(m_symbol.Name(), TimeFrame);
//---
   return(INIT_SUCCEEDED);
  }
//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   IndicatorRelease(handle);
   handle = INVALID_HANDLE;
  }
//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
  {
   if(Apply_Protection_by_date)
     {
      if(TimeCurrent() >= expire_time || TimeLocal() >= expire_time)
        {
         Alert("ea expired");
         ExpertRemove();
         return;
        }
     }
//Trailing(Trailing_Stop, MagicNumber);
   if(new_bar.isNewBar())
     {
      if(TradeTime(TradeBeginTime, TradeEndTime))
        {
         if(CopyBuffers())
           {
            if(GetSignal(POSITION_TYPE_BUY, 1))
              {
               if(!Reverse_Pos)
                 {
                  ClosePositionByType(POSITION_TYPE_SELL, "New Buy Signal");
                  OpenBuy();
                 }
               else
                 {
                  ClosePositionByType(POSITION_TYPE_BUY, "New Sell Signal");
                  OpenSell();
                 }
              }
            if(GetSignal(POSITION_TYPE_SELL, 1))
              {
               if(!Reverse_Pos)
                 {
                  ClosePositionByType(POSITION_TYPE_BUY, "New Sell Signal");
                  OpenSell();
                 }
               else
                 {
                  ClosePositionByType(POSITION_TYPE_SELL, "New Buy Signal");
                  OpenBuy();
                 }
              }
           }
        }
     }
  }
//+------------------------------------------------------------------+
//| Trade function                                                   |
//+------------------------------------------------------------------+
void OnTrade()
  {
  }
//+------------------------------------------------------------------+
//| TradeTransaction function                                        |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
  {
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
bool GetSignal(ENUM_POSITION_TYPE pos_type, int index = 1)
  {
   if(pos_type == POSITION_TYPE_BUY)
     {
      if(check_buffer(buffer.arrow[index]) && buffer.arrow[index] <= iLow(m_symbol.Name(), TimeFrame, index))
         return true;
     }
   if(pos_type == POSITION_TYPE_SELL)
     {
      if(check_buffer(buffer.arrow[index]) && buffer.arrow[index] >= iHigh(m_symbol.Name(), TimeFrame, index))
         return true;
     }
   return false;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
bool CopyBuffers(int index = 1)
  {
   ResetLastError();
   if(CopyBuffer(handle, 7, 0, index + 1, buffer.arrow) < index + 1)
     {
      PrintFormat("Failed to copy data from the Perfect Trend Line indicator, error code %d", GetLastError());
      return false;
     }
   return true;
  }
//+------------------------------------------------------------------+
//| Open Buy position                                                |
//+------------------------------------------------------------------+
bool OpenBuy()
  {
   RefreshRates();
   double open_lot          = CheckMinMaxLots(m_symbol.Name(), LotSize);
   double free_margin_check = m_account.FreeMarginCheck(m_symbol.Name(), ORDER_TYPE_BUY, open_lot, m_symbol.Ask());
   double margin_check      = m_account.MarginCheck(m_symbol.Name(), ORDER_TYPE_BUY, open_lot, m_symbol.Ask());
   if(free_margin_check > margin_check)
     {
      double tp = TakeProfit_Point > 0 ? m_symbol.Ask() + (TPSLCorrection(TakeProfit_Point) * m_symbol.Point()) : 0;
      double sl = StopLoss_Point   > 0 ? m_symbol.Ask() - (TPSLCorrection(StopLoss_Point)   * m_symbol.Point()) : 0;
      //---
      if(m_trade.Buy(open_lot, m_symbol.Name(), m_symbol.Ask(), sl, tp))
        {
         if(Print_Log)
            PrintResultTrade(m_trade, m_symbol);
         return true;
        }
      else
        {
         if(Print_Log)
            PrintResultTrade(m_trade, m_symbol);
         return false;
        }
     }
   else
     {
      if(Print_Log)
         Print(__FILE__, " ", __FUNCTION__, ", ERROR: ", "CAccountInfo.FreeMarginCheck returned the value ", DoubleToString(free_margin_check, 2));
     }
   return false;
  }
//+------------------------------------------------------------------+
//| Open Sell position                                               |
//+------------------------------------------------------------------+
bool OpenSell()
  {
   RefreshRates();
   double open_lot          = CheckMinMaxLots(m_symbol.Name(), LotSize);
   double free_margin_check = m_account.FreeMarginCheck(m_symbol.Name(), ORDER_TYPE_SELL, open_lot, m_symbol.Bid());
   double margin_check      = m_account.MarginCheck(m_symbol.Name(), ORDER_TYPE_SELL, open_lot, m_symbol.Bid());
   if(free_margin_check > margin_check)
     {
      double tp = TakeProfit_Point > 0 ? m_symbol.Bid() - (TPSLCorrection(TakeProfit_Point) * m_symbol.Point()) : 0;
      double sl = StopLoss_Point   > 0 ? m_symbol.Bid() + (TPSLCorrection(StopLoss_Point)   * m_symbol.Point()) : 0;
      //---
      if(m_trade.Sell(open_lot, m_symbol.Name(), m_symbol.Bid(), sl, tp))
        {
         if(Print_Log)
            PrintResultTrade(m_trade, m_symbol);
         return true;
        }
      else
        {
         if(Print_Log)
            PrintResultTrade(m_trade, m_symbol);
         return false;
        }
     }
   else
     {
      if(Print_Log)
         Print(__FILE__, " ", __FUNCTION__, ", ERROR: ", "CAccountInfo.FreeMarginCheck returned the value ", DoubleToString(free_margin_check, 2));
     }
   return false;
  }
//+------------------------------------------------------------------+
//| Print CTrade result                                              |
//+------------------------------------------------------------------+
void PrintResultTrade(CTrade & trade, CSymbolInfo & symbol)
  {
   Print(__FILE__, " ", __FUNCTION__, ", Symbol: ", symbol.Name() + ", " +
         "Code of request result: " + IntegerToString(trade.ResultRetcode()) + ", " +
         "Code of request result as a string: " + trade.ResultRetcodeDescription(),
         "Trade execution mode: " + symbol.TradeExecutionDescription());
   Print("Deal ticket: " + IntegerToString(trade.ResultDeal()) + ", " +
         "Order ticket: " + IntegerToString(trade.ResultOrder()) + ", " +
         "Order retcode external: " + IntegerToString(trade.ResultRetcodeExternal()) + ", " +
         "Volume of deal or order: " + DoubleToString(trade.ResultVolume(), 2));
   Print("StopLoss of deal or order:" + DoubleToString(trade.RequestSL(), symbol.Digits()) + ", " +
         "TakeProfit of deal or order:" + DoubleToString(trade.RequestTP(), symbol.Digits()));
   Print("Price, confirmed by broker: " + DoubleToString(trade.ResultPrice(), symbol.Digits()) + ", " +
         "Current bid price: " + DoubleToString(symbol.Bid(), symbol.Digits()) + " (the requote): " + DoubleToString(trade.ResultBid(), symbol.Digits()) + ", " +
         "Current ask price: " + DoubleToString(symbol.Ask(), symbol.Digits()) + " (the requote): " + DoubleToString(trade.ResultAsk(), symbol.Digits()));
   Print("Broker comment: " + trade.ResultComment());
  }
//+------------------------------------------------------------------+
//| Print CTrade result                                              |
//+------------------------------------------------------------------+
void PrintResultModify(CTrade & trade, CSymbolInfo & symbol, CPositionInfo & position)
  {
   Print("File: ", __FILE__, ", symbol: ", symbol.Name());
   Print("Code of request result: " + IntegerToString(trade.ResultRetcode()));
   Print("code of request result as a string: " + trade.ResultRetcodeDescription());
   Print("Deal ticket: " + IntegerToString(trade.ResultDeal()));
   Print("Order ticket: " + IntegerToString(trade.ResultOrder()));
   Print("Volume of deal or order: " + DoubleToString(trade.ResultVolume(), 2));
   Print("Price, confirmed by broker: " + DoubleToString(trade.ResultPrice(), symbol.Digits()));
   Print("Current bid price: " + DoubleToString(symbol.Bid(), symbol.Digits()) + " (the requote): " + DoubleToString(trade.ResultBid(), symbol.Digits()));
   Print("Current ask price: " + DoubleToString(symbol.Ask(), symbol.Digits()) + " (the requote): " + DoubleToString(trade.ResultAsk(), symbol.Digits()));
   Print("Broker comment: " + trade.ResultComment());
   Print("Freeze Level: " + DoubleToString(symbol.FreezeLevel(), 0), ", Stops Level: " + DoubleToString(symbol.StopsLevel(), 0));
   Print("Price of position opening: " + DoubleToString(position.PriceOpen(), symbol.Digits()));
   Print("Price of position's Stop Loss: " + DoubleToString(position.StopLoss(), symbol.Digits()));
   Print("Price of position's Take Profit: " + DoubleToString(position.TakeProfit(), symbol.Digits()));
   Print("Current price by position: " + DoubleToString(position.PriceCurrent(), symbol.Digits()));
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
bool CheckStopLoss_Takeprofit(ENUM_ORDER_TYPE type, double price, double SL, double TP)
  {
   double ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
   double bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
//--- get the SYMBOL_TRADE_STOPS_LEVEL level
   int    stops_level = (int) SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   if(stops_level != 0)
     {
      PrintFormat("SYMBOL_TRADE_STOPS_LEVEL=%d: StopLoss and TakeProfit must" +
                  " not be nearer than %d points from the closing price", stops_level, stops_level);
     }
//---
   bool SL_check = false, TP_check = false;
//--- check the order type
   switch(type)
     {
      //--- Buy operation
      case  ORDER_TYPE_BUY:
        {
         //--- check the StopLoss
         SL_check = (SL != 0 && bid - SL > stops_level * _Point);
         if(SL != 0 && !SL_check)
            PrintFormat("For order %s   StopLoss=%.5f must be less than %.5f" + " (bid=%.5f - SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), SL, bid - stops_level * _Point, bid, stops_level);
         //--- check the TakeProfit
         TP_check = (TP != 0 && TP - bid > stops_level * _Point);
         if(TP != 0 && !TP_check)
            PrintFormat("For order %s   TakeProfit=%.5f must be greater than %.5f" + " (bid=%.5f + SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), TP, bid + stops_level * _Point, bid, stops_level);
         if(SL == 0)
            SL_check = true;
         if(TP == 0)
            TP_check = true;
         //--- return the result of checking
         return(SL_check && TP_check);
        }
      //--- Sell operation
      case  ORDER_TYPE_SELL:
        {
         //--- check the StopLoss
         SL_check = (SL != 0 && SL - ask > stops_level * _Point);
         if(SL != 0 && !SL_check)
            PrintFormat("For order %s   StopLoss=%.5f must be greater than %.5f" + " (ask=%.5f + SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), SL, ask + stops_level * _Point, ask, stops_level);
         //--- check the TakeProfit
         TP_check = (TP != 0 && ask - TP > stops_level * _Point);
         if(TP != 0 && !TP_check)
            PrintFormat("For order %s   TakeProfit=%.5f must be less than %.5f" + " (ask=%.5f - SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), TP, ask - stops_level * _Point, ask, stops_level);
         if(SL == 0)
            SL_check = true;
         if(TP == 0)
            TP_check = true;
         //--- return the result of checking
         return(TP_check && SL_check);
        }
      break;
      //--- BuyLimit pending order
      case  ORDER_TYPE_BUY_LIMIT:
        {
         //--- check the StopLoss
         SL_check = (SL != 0 && (price - SL) > stops_level * _Point);
         if(SL != 0 && !SL_check)
            PrintFormat("For order %s   StopLoss=%.5f must be less than %.5f" + " (Open-StopLoss=%d points ==> SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), SL, price - stops_level * _Point, (int)((price - SL) / _Point), stops_level);
         //--- check the TakeProfit
         TP_check = (TP != 0 && (TP - price) > stops_level * _Point);
         if(TP != 0 && !TP_check)
            PrintFormat("For order %s   TakeProfit=%.5f must be greater than %.5f" + " (TakeProfit-Open=%d points ==> SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), TP, price + stops_level * _Point, (int)((TP - price) / _Point), stops_level);
         if(SL == 0)
            SL_check = true;
         if(TP == 0)
            TP_check = true;
         //--- return the result of checking
         return(SL_check && TP_check);
        }
      //--- SellLimit pending order
      case  ORDER_TYPE_SELL_LIMIT:
        {
         //--- check the StopLoss
         SL_check = (SL != 0 && (SL - price) > stops_level * _Point);
         if(SL != 0 && !SL_check)
            PrintFormat("For order %s   StopLoss=%.5f must be greater than %.5f" + " (StopLoss-Open=%d points ==> SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), SL, price + stops_level * _Point, (int)((SL - price) / _Point), stops_level);
         //--- check the TakeProfit
         TP_check = (TP != 0 && (price - TP) > stops_level * _Point);
         if(TP != 0 && !TP_check)
            PrintFormat("For order %s   TakeProfit=%.5f must be less than %.5f" + " (Open-TakeProfit=%d points ==> SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), TP, price - stops_level * _Point, (int)((price - TP) / _Point), stops_level);
         if(SL == 0)
            SL_check = true;
         if(TP == 0)
            //--- return the result of checking
            TP_check = true;
         return(TP_check && SL_check);
        }
      break;
      //--- BuyStop pending order
      case  ORDER_TYPE_BUY_STOP:
        {
         //--- check the StopLoss
         SL_check = (SL != 0 && (price - SL) > stops_level * _Point);
         if(SL != 0 && !SL_check)
            PrintFormat("For order %s   StopLoss=%.5f must be less than %.5f" + " (Open-StopLoss=%d points ==> SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), SL, price - stops_level * _Point, (int)((price - SL) / _Point), stops_level);
         //--- check the TakeProfit
         TP_check = (TP != 0 && (TP - price) > stops_level * _Point);
         if(TP != 0 && !TP_check)
            PrintFormat("For order %s   TakeProfit=%.5f must be greater than %.5f" + " (TakeProfit-Open=%d points ==> SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), TP, price - stops_level * _Point, (int)((TP - price) / _Point), stops_level);
         if(SL == 0)
            SL_check = true;
         if(TP == 0)
            TP_check = true;
         //--- return the result of checking
         return(SL_check && TP_check);
        }
      //--- SellStop pending order
      case  ORDER_TYPE_SELL_STOP:
        {
         //--- check the StopLoss
         SL_check = (SL != 0 && (SL - price) > stops_level * _Point);
         if(SL != 0 && !SL_check)
            PrintFormat("For order %s   StopLoss=%.5f must be greater than %.5f" + " (StopLoss-Open=%d points ==> SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), SL, price + stops_level * _Point, (int)((SL - price) / _Point), stops_level);
         //--- check the TakeProfit
         TP_check = (TP != 0 && (price - TP) > stops_level * _Point);
         if(TP != 0 && !TP_check)
            PrintFormat("For order %s   TakeProfit=%.5f must be less than %.5f" + " (Open-TakeProfit=%d points ==> SYMBOL_TRADE_STOPS_LEVEL=%d points)", EnumToString(type), TP, price - stops_level * _Point, (int)((price - TP) / _Point), stops_level);
         if(SL == 0)
            SL_check = true;
         if(TP == 0)
            TP_check = true;
         //--- return the result of checking
         return(TP_check && SL_check);
        }
      break;
     }
//---
   return false;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
int TPSLCorrection(int val)
  {
   int SPREAD    = (int) SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   int StopLevel = (int) SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
   if(val < StopLevel + SPREAD)
      val = StopLevel + SPREAD;
   return(val);
  }
//+------------------------------------------------------------------+
//| Check the correctness of the position volume                     |
//+------------------------------------------------------------------+
bool CheckVolumeValue(double volume, string & error_description)
  {
//--- minimal allowed volume for trade operations
   double min_volume = m_symbol.LotsMin();
   if(volume < min_volume)
     {
      error_description = StringFormat("Volume is less than the minimal allowed SYMBOL_VOLUME_MIN=%.2f", min_volume);
      return(false);
     }
//--- maximal allowed volume of trade operations
   double max_volume = m_symbol.LotsMax();
   if(volume > max_volume)
     {
      error_description = StringFormat("Volume is greater than the maximal allowed SYMBOL_VOLUME_MAX=%.2f", max_volume);
      return(false);
     }
//--- get minimal step of volume changing
   double volume_step = m_symbol.LotsStep();
   int ratio = (int)MathRound(volume / volume_step);
   if(MathAbs(ratio * volume_step - volume) > 0.0000001)
     {
      if(TerminalInfoString(TERMINAL_LANGUAGE) == "Russian")
         error_description = StringFormat("Volume is not a multiple of the minimal step SYMBOL_VOLUME_STEP=%.2f, the closest correct volume is %.2f",
                                          volume_step, ratio * volume_step);
      return(false);
     }
   error_description = "Correct volume value";
//---
   return(true);
  }
//+------------------------------------------------------------------+
//| Refreshes the symbol quotes data                                 |
//+------------------------------------------------------------------+
bool RefreshRates()
  {
//--- refresh rates
   if(!m_symbol.RefreshRates())
     {
      Print(__FILE__, " ", __FUNCTION__, ", ERROR: ", "RefreshRates error");
      return(false);
     }
//--- protection against the return value of "zero"
   if(m_symbol.Ask() == 0 || m_symbol.Bid() == 0)
     {
      Print(__FILE__, " ", __FUNCTION__, ", ERROR: ", "Ask == 0.0 OR Bid == 0.0");
      return(false);
     }
//---
   return(true);
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
double CheckMinMaxLots(string symbol, double lots)
  {
   int    LotDigits = (int) MathCeil(MathAbs(MathLog(SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP)) / MathLog(10)));
   double lotStep   = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   double minLot    = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot    = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   lots = lotStep * MathCeil(lots / lotStep);
   if(lots < minLot)
      lots = minLot;
   if(lots > maxLot)
      lots = maxLot;
   return(NormalizeDouble(lots, LotDigits));
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
double MathNearest(double v, double to)
  {
   return to * MathRound(v / to);
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
double MathRoundDown(double v, double to)
  {
   return to * MathFloor(v / to);
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
double MathRoundUp(double v, double to)
  {
   return to * MathCeil(v / to);
  }
//+------------------------------------------------------------------+
//| Check Freeze and Stops levels                                    |
//+------------------------------------------------------------------+
void FreezeStopsLevels(double & freeze, double & stops)
  {
//--- check Freeze and Stops levels
   /*
   SYMBOL_TRADE_FREEZE_LEVEL shows the distance of freezing the trade operations
      for pending orders and open positions in points
   ------------------------|--------------------|--------------------------------------------
   Type of order/position  |  Activation price  |  Check
   ------------------------|--------------------|--------------------------------------------
   Buy Limit order         |  Ask               |  Ask-OpenPrice  >= SYMBOL_TRADE_FREEZE_LEVEL
   Buy Stop order          |  Ask               |  OpenPrice-Ask  >= SYMBOL_TRADE_FREEZE_LEVEL
   Sell Limit order        |  Bid               |  OpenPrice-Bid  >= SYMBOL_TRADE_FREEZE_LEVEL
   Sell Stop order         |  Bid               |  Bid-OpenPrice  >= SYMBOL_TRADE_FREEZE_LEVEL
   Buy position            |  Bid               |  TakeProfit-Bid >= SYMBOL_TRADE_FREEZE_LEVEL
                           |                    |  Bid-StopLoss   >= SYMBOL_TRADE_FREEZE_LEVEL
   Sell position           |  Ask               |  Ask-TakeProfit >= SYMBOL_TRADE_FREEZE_LEVEL
                           |                    |  StopLoss-Ask   >= SYMBOL_TRADE_FREEZE_LEVEL
   ------------------------------------------------------------------------------------------

   SYMBOL_TRADE_STOPS_LEVEL determines the number of points for minimum indentation of the
      StopLoss and TakeProfit levels from the current closing price of the open position
   ------------------------------------------------|------------------------------------------
   Buying is done at the Ask price                 |  Selling is done at the Bid price
   ------------------------------------------------|------------------------------------------
   TakeProfit        >= Bid                        |  TakeProfit        <= Ask
   StopLoss          <= Bid                        |  StopLoss          >= Ask
   TakeProfit - Bid  >= SYMBOL_TRADE_STOPS_LEVEL   |  Ask - TakeProfit  >= SYMBOL_TRADE_STOPS_LEVEL
   Bid - StopLoss    >= SYMBOL_TRADE_STOPS_LEVEL   |  StopLoss - Ask    >= SYMBOL_TRADE_STOPS_LEVEL
   ------------------------------------------------------------------------------------------
   */
   if(!RefreshRates() || !m_symbol.Refresh())
      return;
//--- FreezeLevel -> for pending order and modification
   freeze = m_symbol.FreezeLevel() * m_symbol.Point();
//--- StopsLevel -> for TakeProfit and StopLoss
   stops = m_symbol.StopsLevel() * m_symbol.Point();
   return;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
string timeFrameToString(ENUM_TIMEFRAMES period)
  {
   switch(period)
     {
      case PERIOD_M1:
         return("M1");
      case PERIOD_M2:
         return("M2");
      case PERIOD_M3:
         return("M3");
      case PERIOD_M4:
         return("M4");
      case PERIOD_M5:
         return("M5");
      case PERIOD_M6:
         return("M6");
      case PERIOD_M10:
         return("M10");
      case PERIOD_M12:
         return("M12");
      case PERIOD_M15:
         return("M15");
      case PERIOD_M20:
         return("M20");
      case PERIOD_M30:
         return("M30");
      case PERIOD_H1:
         return("H1");
      case PERIOD_H2:
         return("H2");
      case PERIOD_H3:
         return("H3");
      case PERIOD_H4:
         return("H4");
      case PERIOD_H6:
         return("H6");
      case PERIOD_H8:
         return("H8");
      case PERIOD_H12:
         return("H12");
      case PERIOD_D1:
         return("D1");
      case PERIOD_W1:
         return("W1");
      case PERIOD_MN1:
         return("MN");
     }
   return IntegerToString(period);
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void ClosePositionByType(ENUM_POSITION_TYPE pos_type = -1, string close_reason = "")
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(m_position.SelectByIndex(i))
        {
         if(m_position.Symbol() == m_symbol.Name() && m_position.Magic() == MagicNumber)
           {
            if(m_position.PositionType() == -1 || m_position.PositionType() == pos_type)
              {
               ulong  ticket = m_position.Ticket();
               string type   = EnumToString(m_position.PositionType());
               if(m_trade.PositionClose(m_position.Ticket()))
                  Print("=====>>  ", type, " position #", ticket, " closed with '" + close_reason + "' option <<=====");
              }
           }
        }
     }
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
int CountAllPositions()
  {
   int count_all = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(m_position.SelectByIndex(i))
        {
         if(m_position.Symbol() == m_symbol.Name() && m_position.Magic() == MagicNumber)
           {
            if(m_position.PositionType() == POSITION_TYPE_BUY || m_position.PositionType() == POSITION_TYPE_SELL)
               count_all++;
           }
        }
     }
   return count_all;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
int CountBuyPositions()
  {
   int count_all = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(m_position.SelectByIndex(i))
        {
         if(m_position.Symbol() == m_symbol.Name() && m_position.Magic() == MagicNumber)
           {
            if(m_position.PositionType() == POSITION_TYPE_BUY)
               count_all++;
           }
        }
     }
   return count_all;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
int CountSellPositions()
  {
   int count_all = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(m_position.SelectByIndex(i))
        {
         if(m_position.Symbol() == m_symbol.Name() && m_position.Magic() == MagicNumber)
           {
            if(m_position.PositionType() == POSITION_TYPE_SELL)
               count_all++;
           }
        }
     }
   return count_all;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
bool IsPositionExist()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(m_position.SelectByIndex(i))
        {
         if(m_position.Symbol() == m_symbol.Name() && m_position.Magic() == MagicNumber)
           {
            if(m_position.PositionType() == POSITION_TYPE_BUY || m_position.PositionType() == POSITION_TYPE_SELL)
               return true;
           }
        }
     }
   return false;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
bool TradeTime(string StartTime, string EndTime)
  {
   datetime time_now, time_begin, time_end;
   time_now   = TimeCurrent();
   time_begin = StringToTime(TimeToString(TimeCurrent(), TIME_DATE) + " " + StartTime);
   time_end   = StringToTime(TimeToString(TimeCurrent(), TIME_DATE) + " " + EndTime);
   if(time_begin < time_end && (time_now < time_begin || time_now > time_end))
      return(false);
   if(time_begin > time_end && time_now < time_begin && time_now > time_end)
      return(false);
   return(true);
  }
//+------------------------------------------------------------------+
//| Breakeven                                                         |
//|   InpBreakevenStop: min distance from price to Stop Loss          |
//+------------------------------------------------------------------+
void Breakeven(ulong ticket, int trigger_point)
  {
   /*
      Buying is done at the Ask price                 |  Selling is done at the Bid price
      ------------------------------------------------|----------------------------------
      TakeProfit        >= Bid                        |  TakeProfit        <= Ask
      StopLoss          <= Bid                        |  StopLoss          >= Ask
      TakeProfit - Bid  >= SYMBOL_TRADE_STOPS_LEVEL   |  Ask - TakeProfit  >= SYMBOL_TRADE_STOPS_LEVEL
      Bid - StopLoss    >= SYMBOL_TRADE_STOPS_LEVEL   |  StopLoss - Ask    >= SYMBOL_TRADE_STOPS_LEVEL
   */
   if(m_position.SelectByTicket(ticket))
     {
      double price_current    = m_position.PriceCurrent();
      double price_open       = m_position.PriceOpen();
      double stop_loss        = m_position.StopLoss();
      double take_profit      = m_position.TakeProfit();
      double ask              = m_symbol.Ask();
      double bid              = m_symbol.Bid();
      double point            = SymbolInfoDouble(m_position.Symbol(), SYMBOL_POINT);
      int    freeze           = (int)SymbolInfoInteger(m_position.Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
      int    stoplevel        = (int)SymbolInfoInteger(m_position.Symbol(), SYMBOL_TRADE_FREEZE_LEVEL);
      int    max_level        = (int)MathMax(freeze, stoplevel);
      double stop_level       = m_symbol.NormalizePrice(max_level * point);
      double m_breakeven_stop = trigger_point  * point;
      double m_breakeven_step = stop_level > 10 * point ? stop_level : 10 * point;
      //---
      if(m_position.PositionType() == POSITION_TYPE_BUY)
        {
         if(price_current - price_open >= m_breakeven_stop)
           {
            if(stop_loss < price_open + m_breakeven_step)
              {
               if(PositionModifyCheck(m_position.Ticket(), m_symbol.NormalizePrice(price_open + m_breakeven_step), take_profit))
                 {
                  if(!m_trade.PositionModify(m_position.Ticket(), m_symbol.NormalizePrice(price_open + m_breakeven_step), take_profit))
                    {
                     Print(__FILE__, " ", __FUNCTION__, ", ERROR: ", "Modify BUY ", m_position.Ticket(),
                           " Position -> false. Result Retcode: ", m_trade.ResultRetcode(),
                           ", description of result: ", m_trade.ResultRetcodeDescription());
                    }
                  else
                    {
                     Print("Position #" + IntegerToString(m_position.Ticket()), " SL Moved to Breakeven");
                    }
                 }
              }
           }
        }
      else
        {
         if(price_open - price_current >= m_breakeven_stop)
           {
            if(stop_loss > price_open - m_breakeven_step || stop_loss == 0)
              {
               if(PositionModifyCheck(m_position.Ticket(), m_symbol.NormalizePrice(price_open - m_breakeven_step), take_profit))
                 {
                  if(!m_trade.PositionModify(m_position.Ticket(), m_symbol.NormalizePrice(price_open - m_breakeven_step), take_profit))
                    {
                     Print(__FILE__, " ", __FUNCTION__, ", ERROR: ", "Modify SELL ", m_position.Ticket(),
                           " Position -> false. Result Retcode: ", m_trade.ResultRetcode(),
                           ", description of result: ", m_trade.ResultRetcodeDescription());
                    }
                  else
                    {
                     Print("Position #", IntegerToString(m_position.Ticket()), " SL Moved to Breakeven");
                    }
                 }
              }
           }
        }
     }
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
bool PositionModifyCheck(ulong ticket, double sl, double tp)
  {
   if(m_position.SelectByTicket(ticket))
     {
      double price_open    = m_position.PriceOpen();
      double stop_loss     = m_position.StopLoss();
      double take_profit   = m_position.TakeProfit();
      double point         = SymbolInfoDouble(m_position.Symbol(), SYMBOL_POINT);
      bool StopLossChanged = (MathAbs(stop_loss - sl) > point);
      bool TakeProfitChanged = (MathAbs(take_profit - tp) > point);
      if(TakeProfitChanged || StopLossChanged)
         return(true);
      //else
      //   PrintFormat("Order #%d already has levels of Open=%.5f SL=%.5f TP=%.5f", ticket, price_open, stop_loss, take_profit);
     }
   return(false);
  }
//+------------------------------------------------------------------+
void Trailing(int trailing_stop, ulong magic = 0)
  {
   if(trailing_stop == 0)
      return;
   double trailingstop = trailing_stop * m_symbol.Point();
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(m_position.SelectByIndex(i))
        {
         if(m_position.Symbol() == m_symbol.Name() && (m_position.Magic() == magic || magic == 0))
           {
            if(m_position.PositionType() == POSITION_TYPE_BUY)
              {
               if(m_position.PriceCurrent() - m_position.PriceOpen() > trailingstop)
                 {
                  if(m_position.StopLoss() < m_position.PriceCurrent() - trailingstop || m_position.StopLoss() == 0)
                    {
                     if(!m_trade.PositionModify(m_position.Ticket(), m_symbol.NormalizePrice(m_position.PriceCurrent() - trailingstop), m_position.TakeProfit()))
                        Print("Trailing BUY ", m_position.Ticket(), " Position -> false. Result Retcode: ", m_trade.ResultRetcode(), ", description of result: ", m_trade.ResultRetcodeDescription());
                    }
                 }
              }
            else
              {
               if(m_position.PriceOpen() - m_position.PriceCurrent() > trailingstop)
                 {
                  if(m_position.StopLoss() > m_position.PriceCurrent() + trailingstop || m_position.StopLoss() == 0)
                    {
                     if(!m_trade.PositionModify(m_position.Ticket(), m_symbol.NormalizePrice(m_position.PriceCurrent() + trailingstop), m_position.TakeProfit()))
                        Print("Trailing SELL ", m_position.Ticket(), " Position -> false. Result Retcode: ", m_trade.ResultRetcode(), ", description of result: ", m_trade.ResultRetcodeDescription());
                    }
                 }
              }
           }
        }
     }
  }
//+------------------------------------------------------------------+
